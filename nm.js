(function () {
    'use strict'

    if (window.lampa_nm_ready) return
    window.lampa_nm_ready = true

    var NS = 'lampa_nm_'
    var COMPONENT = 'lampa_nm_list'
    var NAME = 'NNM-Club'
    var DEFAULT_PROXY_URL = 'http://192.168.11.71:8787'
    var PAGE_LIMIT = 60

    var SECTIONS = [
        { value: 'movies_new', title: 'Новинки кино' },
        { value: 'movies_foreign', title: 'Зарубежное кино (вкл. HD, UHD)' },
        { value: 'series_ru', title: 'Наши сериалы' },
        { value: 'series_foreign', title: 'Зарубежные сериалы' },
        { value: 'doc', title: 'Документалки и ТВ-бренды' },
        { value: 'theater', title: 'Театр и МузВидео' }
    ]

    function field(name, fallback) {
        var value = Lampa.Storage.field(NS + name)
        return value === undefined || value === null ? fallback : value
    }

    function safeHttpUrl(value) {
        if (!value) return ''
        try {
            var URLConstructor = window.URL || window.webkitURL
            if (!URLConstructor) return /^https?:\/\/[^\s]+$/i.test(String(value)) ? String(value) : ''
            var parsed = new URLConstructor(String(value))
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
            if (parsed.username || parsed.password) return ''
            return parsed.toString()
        } catch (e) { return '' }
    }

    function safeMagnet(value) {
        return /^magnet:\?xt=urn:btih:[a-z0-9]{6,}(?:&[^\s]*)?$/i.test(String(value || '')) ? String(value) : ''
    }

    function number(value) {
        var parsed = Number(value)
        return isFinite(parsed) ? parsed : 0
    }

    function normalize(item) {
        item = item || {}
        return {
            id: String(item.id || item.title || Math.random()),
            title: String(item.title || item.name || 'Без названия'),
            original_title: String(item.original_title || ''),
            year: item.year ? number(item.year) : '',
            type: String(item.type || 'movie'),
            poster: safeHttpUrl(item.poster || ''),
            overview: String(item.overview || ''),
            quality: String(item.quality || ''),
            source_url: safeHttpUrl(item.source_url || ''),
            magnet: safeMagnet(item.magnet || '')
        }
    }

    function parseListResponse(response) {
        var data = response
        if (typeof data === 'string') data = JSON.parse(data)
        data = data || {}
        var list = Array.isArray(data.results) ? data.results : []
        return { page: number(data.page) || 1, total_pages: number(data.total_pages) || 1, results: list.map(normalize) }
    }

    function notify(message, error) {
        if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message, error ? { style: 'error', time: 6000 } : undefined)
    }

    function logError(message, error) {
        if (window.console && console.error) console.error('[lampa-nm]', message, error || '')
    }

    function Provider(baseUrl) {
        this.baseUrl = safeHttpUrl(baseUrl).replace(/\/$/, '')
        this.network = new Lampa.Reguest()
        this.network.timeout(30000)
    }
    Provider.prototype.list = function (section, done, fail) {
        if (!this.baseUrl) return fail('Не указан адрес локального API')
        var url = this.baseUrl + '/nm/v1/list?section=' + encodeURIComponent(section) + '&limit=' + PAGE_LIMIT
        this.network.silent(url, function (response) {
            try { done(parseListResponse(response)) } catch (e) { fail('Локальный API вернул неверный JSON') }
        }, function (xhr, exception) {
            fail(this.network.errorDecode ? this.network.errorDecode(xhr, exception) : 'Ошибка локального API')
        }.bind(this))
    }
    Provider.prototype.clear = function () { this.network.clear() }

    function makeCardData(item) {
        var card = $.extend({}, item)
        card.poster = card.poster || ''
        card.img = card.img || card.poster || ''
        card.source = card.source || 'nm'
        card.params = card.params || {}
        return card
    }

    /*
     * TMDB-поиск руками LAMPA: открываем штатный экран карточки.
     */
    function cleanQuery(value) {
        return String(value || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    }

    function collectSearchGroups(response) {
        if (Array.isArray(response)) return response
        if (response && typeof response === 'object') return [response.movie, response.tv].filter(Boolean)
        return []
    }

    /*
     * Поиск TMDB-карточки для гибридных обложек и названий эпизодов.
     * confident=true — только совпадение по типу и году (для замены уже
     * готового постера), иначе любое совпадение по типу.
     */
    function tmdbMatchFor(item, confident, done) {
        try {
            if (!Lampa.Api || typeof Lampa.Api.search !== 'function') return done(null)
            var queries = []
            ;[cleanQuery(item.original_title), cleanQuery(item.title)].forEach(function (q) {
                if (q && queries.indexOf(q) < 0) queries.push(q)
            })
            if (!queries.length) return done(null)

            var yearMatch = String(item.title || '').match(/\[(\d{4})\s*г|\((\d{4})\)/)
            var year = item.year || (yearMatch ? (+yearMatch[1] || +yearMatch[2]) : '')

            function tryQ(index) {
                if (index >= queries.length) return done(null)
                Lampa.Api.search({ query: queries[index], page: 1 }, function (response) {
                    var wantType = item.type === 'series' ? 'tv' : 'movie'
                    var pool = []
                    collectSearchGroups(response).forEach(function (g) {
                        if (g && g.type === wantType && Array.isArray(g.results)) pool = pool.concat(g.results)
                    })
                    if (!pool.length) return tryQ(index + 1)

                    var best = null
                    if (year) {
                        pool.some(function (r) {
                            var date = r.release_date || r.first_air_date || ''
                            if (String(date).slice(0, 4) === String(year)) { best = r; return true }
                            return false
                        })
                    }
                    if (!best) {
                        if (confident) return tryQ(index + 1)
                        best = pool[0]
                    }

                    done(best)
                }, function () { tryQ(index + 1) })
            }

            tryQ(0)
        } catch (e) { done(null) }
    }

    function tmdbPosterFor(item, confident, done) {
        tmdbMatchFor(item, confident, function (best) {
            try {
                var path = (best && best.poster_path) || ''
                done(path && Lampa.Api.img ? Lampa.Api.img(path, 'w300') : '')
            } catch (e) { done('') }
        })
    }

    function padNum(n) {
        n = Math.max(0, +n || 0)
        return (n < 10 ? '0' : '') + n
    }

    function openCard(item) {
        var native = field('native_cards', 'on') === 'on'
        var canNative = native && Lampa.Api && typeof Lampa.Api.search === 'function' && Lampa.Router && Lampa.Router.call

        if (!canNative) return openFallbackDetail(item)

        var queries = []
        ;[cleanQuery(item.original_title), cleanQuery(item.title)].forEach(function (query) {
            if (query && queries.indexOf(query) < 0) queries.push(query)
        })
        if (!queries.length) return openFallbackDetail(item)

        function trySearch(index) {
            if (index >= queries.length) return openFallbackDetail(item)

            Lampa.Api.search({ query: queries[index], page: 1 }, function (response) {
                var wantType = item.type === 'series' ? 'tv' : 'movie'
                var pool = []
                collectSearchGroups(response).forEach(function (group) {
                    if (group && group.type === wantType && Array.isArray(group.results)) pool = pool.concat(group.results)
                })
                if (!pool.length) {
                    collectSearchGroups(response).forEach(function (group) {
                        if (group && group.type !== 'person' && Array.isArray(group.results)) pool = pool.concat(group.results)
                    })
                }
                if (!pool.length) return trySearch(index + 1)

                var best = null
                if (item.year) {
                    pool.some(function (result) {
                        var date = result.release_date || result.first_air_date || ''
                        if (String(date).slice(0, 4) === String(item.year)) { best = result; return true }
                        return false
                    })
                }
                if (!best) best = pool[0]

                best.source = 'tmdb'
                best.kinozal_item = item
                Lampa.Router.call('full', best)
            }, function () { trySearch(index + 1) })
        }

        trySearch(0)
    }

    function openFallbackDetail(item) {
        Lampa.Activity.push({ url: '', title: item.title, component: 'lampa_nm_detail', item: item, page: 1 })
    }

    function pushScreen(section) {
        // Запоминаем последний раздел — следующий вход откроет его же
        Lampa.Storage.set(NS + 'section', section)
        Lampa.Activity.push({ url: '', title: NAME, component: COMPONENT, page: 1, section: section })
    }

    function openSectionMenu(current) {
        var currentTitle = (SECTIONS.filter(function (s) { return s.value === current })[0] || SECTIONS[0]).title
        Lampa.Select.show({
            title: NAME + ' — разделы',
            items: SECTIONS.map(function (s) {
                return { title: s.title + (s.value === current ? ' · текущий' : ''), value: s.value }
            }),
            onSelect: function (item) {
                Lampa.Select.close()
                pushScreen(item.value)
            },
            // Select.close() уже вызывает onBack — повторный close даёт рекурсию.
            onBack: function () { Lampa.Controller.toggle('content') }
        })
    }

    /*
     * LAMPA 3.x: штатный экран-категория.
     */
    function MakerScreen(object) {
        var provider = new Provider(field('proxy_url', '') || DEFAULT_PROXY_URL)
        var section = String(object.section || field('section', 'movies_new'))

        // Гибридные обложки: уверенное совпадение в TMDB (тип + год) заменяет
        // постер из темы — первая картинка поста не всегда обложка.
        var chains = [Promise.resolve(), Promise.resolve(), Promise.resolve()]
        var chainIdx = 0
        var posterBudget = 40

        function setPoster(card, data, poster) {
            data.poster = poster
            data.img = poster
            try {
                var el = card.render(true)
                var img = el.querySelector ? el.querySelector('.card__img') : null
                if (img) img.src = poster
                else $(el).find('.card__img').attr('src', poster)
            } catch (e) { }
        }

        var comp = Lampa.Maker.make('Category', { title: NAME, page: 1 })

        comp.use({
            onCreate: function () {
                this.activity.loader(true)
                provider.list(section, function (data) {
                    comp.build({ results: data.results.map(makeCardData), total_pages: 1 })
                }, function (message) {
                    notify(message, true)
                    comp.empty()
                })
            },
            // Вправо за последнюю карточку — меню разделов.
            onController: function (controller) {
                controller.right = function () {
                    if (Lampa.Navigator && Lampa.Navigator.canmove && Lampa.Navigator.canmove('right')) Lampa.Navigator.move('right')
                    else if (window.Navigator && window.Navigator.canmove('right')) window.Navigator.move('right')
                    else openSectionMenu(section)
                }
            },
            onInstance: function (card, data) {
                card.use({
                    onlyEnter: function () { openCard(data) }
                })
                if (data.id && posterBudget > 0) {
                    posterBudget--
                    var idx = chainIdx++ % chains.length
                    chains[idx] = chains[idx].then(function () {
                        return new Promise(function (resolve) {
                            tmdbPosterFor(data, !!data.poster, function (p) {
                                if (p) setPoster(card, data, p)
                                resolve()
                            })
                        })
                    }).catch(function () { })
                }
            }
        })

        return comp
    }

    /*
     * LAMPA 2.x fallback.
     */
    function LegacyScreen(object) {
        var provider = new Provider(field('proxy_url', '') || DEFAULT_PROXY_URL)
        var section = String(object.section || field('section', 'movies_new'))

        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250, end_ratio: 2 })
        var body = $('<div class="category-full"></div>')
        var html = document.createElement('div')
        var items = []
        var last = false
        var active = 0

        function appendCards(data) {
            data.results.forEach(function (element) {
                var card
                try { card = new Lampa.Card(element, { object: object }) }
                catch (e) { card = new Lampa.Card($.extend({ title: element.title }, element)) }
                card.create()
                card.onFocus = function (target) {
                    last = target
                    active = items.indexOf(card)
                    scroll.update(target)
                }
                card.onTouch = function (target) { last = target; active = items.indexOf(card) }
                card.onEnter = function () { openCard(element) }
                body.append(card.render(true))
                items.push(card)
            })
        }

        function nav() {
            return (Lampa.Navigator && Lampa.Navigator.canmove) ? Lampa.Navigator : window.Navigator
        }

        function limitView() {
            var collection = items.slice(Math.max(0, active - 12), active + 12)
            items.forEach(function (item) {
                item.render(true).toggleClass('layer--render', collection.indexOf(item) >= 0)
            })
            if (nav().setCollection) {
                nav().setCollection(items.slice(Math.max(0, active - 36), active + 36).map(function (c) { return c.render(true) }))
                nav().focused(last)
            }
            if (Lampa.Layer && Lampa.Layer.visible) Lampa.Layer.visible(scroll.render(true))
        }

        function empty() {
            var hint = $('<div style="padding:2em;color:#fff;opacity:.7">Ничего не получено. Проверьте адрес локального API в настройках плагина ' + NAME + '.</div>')
            scroll.append(hint)
            $(html).append(scroll.render(true))
            this.activity.loader(false)
            this.activity.toggle()
        }

        var instance = this

        function startController() {
            Lampa.Controller.add('content', {
                link: this,
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(true))
                    Lampa.Controller.collectionFocus(last || false, scroll.render(true))
                },
                left: function () {
                    if (nav().canmove('left')) nav().move('left')
                    else Lampa.Controller.toggle('menu')
                },
                right: function () {
                    if (nav().canmove('right')) nav().move('right')
                    else openSectionMenu(section)
                },
                up: function () {
                    if (nav().canmove('up')) nav().move('up')
                    else Lampa.Controller.toggle('head')
                },
                down: function () {
                    if (nav().canmove('down')) nav().move('down')
                },
                back: function () { Lampa.Activity.backward() }
            })
            Lampa.Controller.toggle('content')
        }

        this.create = function () {
            this.activity.loader(true)
            provider.list(section, function (data) {
                totalBuild(data)
            }, function (message) {
                notify(message, true)
                empty.call(instance)
            })
            return this.render()
        }

        function totalBuild(data) {
            if (!data.results.length) return empty.call(instance)
            scroll.minus()
            scroll.onWheel = function (step) {
                if (!Lampa.Controller.own(instance)) startController.call(instance)
                nav().move(step > 0 ? 'down' : 'up')
            }
            appendCards(data)
            scroll.append(body)
            $(html).append(scroll.render(true))
            limitView()
            instance.activity.loader(false)
            instance.activity.toggle()
        }

        this.render = function () { return $(html) }
        this.start = startController
        this.stop = function () {}
        this.pause = function () {}
        this.destroy = function () { provider.clear(); items.forEach(function (card) { if (card.destroy) card.destroy() }); scroll.destroy(); $(html).remove() }
    }

    function ListScreen(object) {
        var hasMaker = !!(Lampa.Maker && Lampa.Maker.make && Lampa.Maker.get('Category'))
        return hasMaker ? MakerScreen(object) : LegacyScreen(object)
    }

    function DetailScreen(object) {
        var item = normalize(object.item)
        var scroll = new Lampa.Scroll({ mask: true, over: true })
        var last = false
        var body = $('<div class="settings-body"></div>')

        var VIDEO_EXT = ['mp4', 'mkv', 'avi', 'ts', 'm2ts', 'mov', 'flv', 'webm', 'wmv', 'mpg', 'mpeg', 'm4v', 'vob']

        function escapeHtml(value) {
            return String(value || '').replace(/[<>&"]/g, function (c) {
                return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
            })
        }

        function torrBase() {
            if (Lampa.Torserver && Lampa.Torserver.url) {
                var u = Lampa.Torserver.url()
                if (u) return u.replace(/\/$/, '')
            }
            return (safeHttpUrl(field('torr_url', 'http://127.0.0.1:8090')) || '').replace(/\/$/, '')
        }

        function shortName(path) {
            return path.split('/').pop().split('\\').pop()
        }

        function naturalSort(a, b) {
            var an = a.path.replace(/\d+/g, function (m) { return m.length > 3 ? m : ('000' + m).substr(-4) })
            var bn = b.path.replace(/\d+/g, function (m) { return m.length > 3 ? m : ('000' + m).substr(-4) })
            return an.localeCompare(bn)
        }

        /*
         * Прогресс буферизации: греем кэш TorrServer запросом /stream?preload
         * и опрашиваем /cache, пока файл не догрузится. Потом — плеер.
         */
        var bufferTimer = null
        var bufferController = null

        function humanSpeed(bytes) {
            var v = Number(bytes) || 0
            if (v > 1048576) return (v / 1048576).toFixed(1) + ' MB/s'
            if (v > 1024) return (v / 1024).toFixed(0) + ' KB/s'
            return v.toFixed(0) + ' B/s'
        }

        function stopBuffering() {
            if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null }
            if (bufferController) { try { bufferController.abort() } catch (e) { } bufferController = null }
        }

        function startBuffering(base, hash, file, files) {
            var index = typeof file.id !== 'undefined' ? file.id : files.indexOf(file)
            var name = shortName(file.path)

            function url(mode) {
                if (Lampa.Torserver && Lampa.Torserver.stream) {
                    return Lampa.Torserver.stream(name, hash, index).replace('&preload', '&' + mode)
                }
                return base + '/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + index + '&' + mode
            }

            mode = 'buffer'
            stopBuffering()
            try { bufferController = new AbortController() } catch (e) { bufferController = null }

            // Неблокирующий прогрев кэша; соединение живёт, пока не отыграем или не отменим
            try {
                var opts = bufferController ? { signal: bufferController.signal } : undefined
                fetch(url('preload'), opts).catch(function () { })
            } catch (e) { }

            body.empty()
            body.append($('<h2 style="color:#fff;font-size:1.4em;margin:1em 1.5em .5em">Загрузка раздачи…</h2>'))
            body.append($('<div style="margin:0 1.5em;height:.4em;background:rgba(255,255,255,.15);border-radius:.2em"><div class="nm-buffer-bar" style="height:100%;width:0;background:#3d7dd8;border-radius:.2em"></div></div>'))
            body.append($('<p class="nm-buffer-text" style="color:#fff;opacity:.85;margin:.5em 1.5em">0%</p>'))
            var skipBtn = $('<div class="simple-button selector" style="margin:1em 1.5em;display:inline-flex">&#9654; Воспроизвести сейчас</div>')
            skipBtn.on('hover:focus', function () { last = skipBtn; scroll.update(skipBtn) })
            skipBtn.on('hover:enter', function () {
                stopBuffering()
                playFile(base, hash, file, files)
            })
            body.append(skipBtn)
            scroll.reset()
            Lampa.Controller.toggle('content')

            var cacheNet = new Lampa.Reguest()
            cacheNet.timeout(5000)
            var attempts = 0
            var errors = 0

            function done() {
                stopBuffering()
                cacheNet.clear()
                playFile(base, hash, file, files)
            }

            function tick() {
                if (closed) return
                attempts++
                if (attempts > 120) return done() // 2 минуты — играем как есть
                cacheNet.silent(base + '/cache', function (state) {
                    if (closed) return
                    var preloaded = Number(state && state.torrent && state.torrent.preloaded_bytes) || 0
                    var preloadSize = Number(state && state.torrent && state.torrent.preload_size) || 0
                    var speed = Number(state && state.torrent && state.torrent.download_speed) || 0
                    var percent = 0
                    if (preloadSize > 0) percent = Math.min(100, Math.round(preloaded / preloadSize * 100))
                    else if (Number(state && state.capacity) > 0) percent = Math.min(100, Math.round((Number(state.filled) || 0) / Number(state.capacity) * 100))
                    var text = percent + '%'
                    if (speed > 0) text += ' · ' + humanSpeed(speed)
                    body.find('.nm-buffer-bar').css('width', percent + '%')
                    body.find('.nm-buffer-text').text(text)
                    if (percent >= 100) return done()
                    bufferTimer = setTimeout(tick, 1000)
                }, function () {
                    // /cache не отвечает — несколько ошибок подряд: играем сразу
                    if (closed) return
                    errors++
                    if (errors >= 3) return done()
                    bufferTimer = setTimeout(tick, 1000)
                }, JSON.stringify({ action: 'get', hash: hash }))
            }

            bufferTimer = setTimeout(tick, 1000)
        }

        function playFile(base, hash, file, files) {
            var index = typeof file.id !== 'undefined' ? file.id : files.indexOf(file)
            var name = shortName(file.path)

            // Адрес потока: через Lampa.Torserver.stream (учитывает gstreamer-
            // транскодинг TorrServer'а), иначе напрямую /stream
            var url
            if (Lampa.Torserver && Lampa.Torserver.stream) {
                url = Lampa.Torserver.stream(name, hash, index).replace('&preload', '&play')
            } else {
                url = base + '/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + index + '&play'
            }

            // torrent_hash включает автопереход на Android-плеер (MKV/DTS там
            // декодируются нормально), launch_player принудительно задаёт режим
            var element = { title: item.title, url: url, torrent_hash: hash }
            var playerMode = field('player', 'auto')
            if (playerMode === 'lampa') element.launch_player = 'lampa'
            if (playerMode === 'android') element.launch_player = 'android'

            Lampa.Player.play(element)
            Lampa.Player.callback(function () { Lampa.Controller.toggle('content') })
            Lampa.Player.playlist(files.map(function (f) {
                var findex = typeof f.id !== 'undefined' ? f.id : files.indexOf(f)
                var furl = Lampa.Torserver && Lampa.Torserver.stream
                    ? Lampa.Torserver.stream(shortName(f.path), hash, findex).replace('&preload', '&play')
                    : base + '/stream/' + encodeURIComponent(shortName(f.path)) + '?link=' + hash + '&index=' + findex + '&play'
                return { title: shortName(f.path), url: furl, torrent_hash: hash }
            }))
        }

        function getVideoFiles(base, hash, done, fail) {
            var attempt = 0
            var network = new Lampa.Reguest()
            network.timeout(15000)

            function extract(json) {
                return ((json || {}).file_stats || []).filter(function (f) {
                    return VIDEO_EXT.indexOf(String(f.path).split('.').pop().toLowerCase()) >= 0
                })
            }

            function tick() {
                if (closed) return
                attempt++
                if (attempt > 15) return fail('Раздача не загружается: нет данных от TorrServer (возможно, нет сидов)')
                network.silent(base + '/torrents', function (json) {
                    if (closed) return
                    var files = extract(json)
                    if (files.length) return done(files)
                    notify('Раздача загружается… ' + attempt * 2 + ' c')
                    setTimeout(tick, 2000)
                }, function () {
                    if (closed) return
                    setTimeout(tick, 2000)
                }, JSON.stringify({ action: 'get', hash: hash }))
            }

            tick()
        }

        /*
         * История просмотров LAMPA: после успешного добавления раздачи в TorrServer
         * пишем карточку в Favorite.history. Сначала пробуем нативную TMDB-карточку
         * (полноценный экран при Enter из истории), иначе свою минималистичную.
         */
        function recordHistory() {
            try {
                if (!Lampa.Favorite || typeof Lampa.Favorite.add !== 'function') return

                var queries = []
                ;[cleanQuery(item.original_title), cleanQuery(item.title)].forEach(function (q) {
                    if (q && queries.indexOf(q) < 0) queries.push(q)
                })

                var yearMatch = String(item.title).match(/\[(\d{4})\s*г/)
                var year = item.year || (yearMatch ? +yearMatch[1] : '')

                function add(card) {
                    try { Lampa.Favorite.add('history', card) } catch (e) { }
                }

                function addCustom() {
                    var card = {
                        id: NS + 'torrent_' + item.id,
                        title: item.title,
                        original_title: item.original_title || '',
                        poster: item.poster || '',
                        img: item.poster || '',
                        release_date: year ? year + '-01-01' : '',
                        overview: item.overview || '',
                        source: 'nm'
                    }
                    if (item.type === 'series') {
                        card.name = item.title
                        card.original_name = item.original_title || item.title
                        card.first_air_date = card.release_date
                    }
                    add(card)
                }

                function tryNative(index) {
                    if (index >= queries.length) return addCustom()
                    Lampa.Api.search({ query: queries[index], page: 1 }, function (response) {
                        var wantType = item.type === 'series' ? 'tv' : 'movie'
                        var pool = []
                        collectSearchGroups(response).forEach(function (g) {
                            if (g && g.type === wantType && Array.isArray(g.results)) pool = pool.concat(g.results)
                        })
                        if (!pool.length) return tryNative(index + 1)

                        var best = null
                        if (year) {
                            pool.some(function (r) {
                                var date = r.release_date || r.first_air_date || ''
                                if (String(date).slice(0, 4) === String(year)) { best = r; return true }
                                return false
                            })
                        }
                        if (!best) best = pool[0]

                        best.source = 'tmdb'
                        add(best)
                    }, function () { tryNative(index + 1) })
                }

                if (queries.length && Lampa.Api && typeof Lampa.Api.search === 'function') tryNative(0)
                else addCustom()
            } catch (e) { logError('recordHistory', e) }
        }

        function watchStart(magnet) {
            var base = torrBase()
            if (!base) return notify('Не указан адрес TorrServer (настройки LAMPA или плагина ' + NAME + ')', true)
            if (!Lampa.Player || !Lampa.Player.play) return notify('Плеер LAMPA недоступен в этой версии', true)

            notify('Добавляю раздачу в TorrServer…')

            var network = new Lampa.Reguest()
            network.timeout(30000)

            function fail(message) { notify(typeof message === 'string' ? message : 'TorrServer не принял раздачу', true) }

            // hash живёт на уровне watch(): openFiles вызывается и из getVideoFiles,
            // где колбэк-область с var hash недоступна (ReferenceError: hash is not defined)
            var hash = ''

            function openFiles(files) {
            showFileList(base, hash, files)
        }

            network.silent(base + '/torrents', function (torrent) {
                hash = torrent && torrent.hash
                if (!hash) return fail()

                recordHistory()

                // Метаданные магнита могут догружаться несколько секунд — ждём файлы
                var ready = ((torrent || {}).file_stats || []).filter(function (f) {
                    return VIDEO_EXT.indexOf(String(f.path).split('.').pop().toLowerCase()) >= 0
                })
                if (ready.length) return openFiles(ready)

                getVideoFiles(base, hash, openFiles, fail)
            }, fail, JSON.stringify({
                action: 'add',
                link: magnet,
                title: item.title,
                poster: item.poster || '',
                save_to_db: false,
                category: item.type === 'series' ? 'tv' : 'movie'
            }))
        }

        var hasData = !!(object.item && (object.item.id || object.item.title))

        function humanSize(bytes) {
            var v = Number(bytes) || 0
            if (v > 1073741824) return (v / 1073741824).toFixed(2) + ' GB'
            if (v > 1048576) return (v / 1048576).toFixed(0) + ' MB'
            return (v / 1024).toFixed(0) + ' KB'
        }

        function addWatchStyle() {
            if (window.lampa_nm_watch_style) return
            window.lampa_nm_watch_style = true
            $('<style>').text('.nm-watch{background:#3d7dd8;color:#fff;opacity:.8}.nm-watch.focus{background:#fff;color:#000;opacity:1}').appendTo('head')
        }

        function buildDetail() {
            body.empty()

            var head = hasData
                ? $('<h2 style="color:#fff;font-size:1.6em;margin:1em 1.5em .5em">' + escapeHtml(item.title) + '</h2>')
                : $('<h2 style="color:#fff;font-size:1.6em;margin:1em 1.5em .5em">Раздача недоступна</h2>')
            if (hasData && item.original_title) head.append('<div style="opacity:.6;font-size:.7em">' + escapeHtml(item.original_title) + '</div>')
            body.append(head)

            if (hasData && item.poster) {
                body.append('<div style="margin:0 1.5em"><img src="' + escapeHtml(item.poster) + '" style="width:11em;border-radius:.4em;float:left;margin-right:1.2em"></div>')
            }

            var meta = [item.year, item.quality].filter(Boolean).join(' · ')
            if (hasData && meta) body.append('<p style="color:#fff;opacity:.8;margin:.5em 1.5em;clear:left">' + escapeHtml(meta) + '</p>')
            if (hasData && item.overview) body.append('<p style="color:#fff;opacity:.85;line-height:1.45;margin:.5em 1.5em;clear:left">' + escapeHtml(item.overview) + '</p>')

            if (!hasData) {
                body.append('<p style="color:#fff;opacity:.85;margin:1em 1.5em">Данные раздачи не сохранились после перезапуска LAMPA. Нажмите влево, чтобы открыть главное меню, или вправо — чтобы выбрать раздел NM.</p>')
            }

            function addButton(name, callback) {
                var btn = $('<div class="settings-param selector"><div class="settings-param-name">' + escapeHtml(name) + '</div></div>')
                btn.on('hover:focus', function () {
                    last = btn
                    scroll.update(btn)
                })
                btn.on('hover:enter', callback)
                body.append(btn)
            }

            if (hasData && item.magnet) {
                addWatchStyle()
                var watch = $('<div class="simple-button selector nm-watch" style="margin:1em 1.5em;display:inline-flex">&#9654; Смотреть (TorrServer)</div>')
                watch.on('hover:focus', function () {
                    last = watch
                    scroll.update(watch)
                })
                watch.on('hover:enter', function () { watchStart(item.magnet) })
                body.append(watch)
            }
        }

        // Экран выбора файла вместо Lampa.Select: Select на большом списке
        // подвешивал слабые ТВ-устройства намертво.
        function showFileList(base, hash, files) {
            mode = 'files'
            filesState = { base: base, hash: hash, files: files }
            last = false
            body.empty()
            // Человекочитаемые имена файлов (ядро LAMPA чистит релизный мусор)
            try { if (Lampa.Torserver && Lampa.Torserver.clearFileName) Lampa.Torserver.clearFileName(files) } catch (e) { }

            body.append($('<h2 style="color:#fff;font-size:1.4em;margin:1em 1.5em .5em">Файлы раздачи (' + files.length + ')</h2>'))
            var rows = []
            files.slice(0, 300).forEach(function (f) {
                var btn = $('<div class="settings-param selector"><div class="settings-param-name">' + escapeHtml(fileLabel(f)) + '</div><div class="settings-param-value">' + humanSize(f.length) + '</div></div>')
                btn.on('hover:focus', function () { scroll.update(btn) })
                btn.on('hover:enter', function () { startBuffering(base, hash, f, files) })
                body.append(btn)
                rows.push({ f: f, btn: btn })
            })
            updateEpisodeTitles(rows)
            scroll.reset()
            Lampa.Controller.toggle('content')
        }

        // Метка файла: для сериалов — S01E02 из имени файла (EpisodeParser ядра)
        function fileLabel(f) {
            var base = f.path_human || shortName(f.path)
            if (item.type === 'series') {
                try {
                    if (Lampa.Torserver && Lampa.Torserver.parse) {
                        var p = Lampa.Torserver.parse({ path: f.path, filename: shortName(f.path), movie: { number_of_seasons: 1, original_title: item.original_title || item.title }, is_file: false })
                        if (p && p.episode) {
                            f.__se = p
                            return 'S' + padNum(p.season) + 'E' + padNum(p.episode) + ' · ' + base
                        }
                    }
                } catch (e) { }
            }
            return base
        }

        // Названия эпизодов из TMDB: найдя карточку, тянем сезоны и
        // обновляем строки списка по мере поступления данных
        function updateEpisodeTitles(rows) {
            if (item.type !== 'series' || !Lampa.Api || !Lampa.Api.seasons || !Lampa.Api.search) return
            tmdbMatchFor(item, false, function (tv) {
                if (!tv || !tv.id) return
                var seasons = []
                rows.forEach(function (r) {
                    if (r.f.__se && seasons.indexOf(r.f.__se.season) < 0) seasons.push(r.f.__se.season)
                })
                seasons.slice(0, 3).forEach(function (sn) {
                    try {
                        Lampa.Api.seasons(tv, sn, function (data) {
                            var map = {}
                            ((data || {}).episodes || []).forEach(function (ep) { map[+ep.episode_number] = ep.name || '' })
                            rows.forEach(function (r) {
                                var se = r.f.__se
                                if (!se || se.season !== sn) return
                                var name = map[+se.episode]
                                if (name) try { r.btn.find('.settings-param-name').text('S' + padNum(se.season) + 'E' + padNum(se.episode) + ' · ' + name) } catch (e) { }
                            })
                        })
                    } catch (e) { }
                })
            })
        }

        function restoreDetail() {
            mode = 'detail'
            filesState = null
            last = false
            buildDetail()
            scroll.reset()
            Lampa.Controller.toggle('content')
        }

        function startController() {
            try {
                Lampa.Controller.add('content', {
                    link: this,
                    toggle: function () {
                        Lampa.Controller.collectionSet(scroll.render(true))
                        Lampa.Controller.collectionFocus(last || body.find('.selector').first(), scroll.render(true))
                    },
                    left: function () { Lampa.Controller.toggle('menu') },
                    right: function () { openSectionMenu(field('section', 'movies_new')) },
                    up: function () {
                        if (Lampa.Navigator && Lampa.Navigator.canmove) Lampa.Navigator.move('up')
                        else if (window.Navigator && window.Navigator.canmove) window.Navigator.move('up')
                        else Lampa.Controller.toggle('head')
                    },
                    down: function () {
                        if (Lampa.Navigator && Lampa.Navigator.canmove) Lampa.Navigator.move('down')
                        else if (window.Navigator && window.Navigator.canmove) window.Navigator.move('down')
                    },
                    back: function () {
                        if (mode === 'buffer') {
                            stopBuffering()
                            restoreDetail()
                        }
                        else if (mode === 'files') restoreDetail()
                        else Lampa.Activity.backward()
                    }
                })
                Lampa.Controller.toggle('content')
            } catch (e) {
                logError('startController', e)
                Lampa.Noty.show(NAME + ' detail error: ' + e.message, true)
            }
        }

        var mode = 'detail'
        var filesState = null
        var closed = false

        this.create = function () {
            buildDetail()
            scroll.append(body)
            var result = this.render()
            // Страховка: если LAMPA не вызовет start(), контроллер всё равно зарегистрирован
            startController.call(this)
            return result
        }
        this.render = function () { return scroll.render() }
        this.start = function () { startController.call(this) }
        this.stop = function () {}
        this.pause = function () {}
        this.destroy = function () { closed = true; stopBuffering(); scroll.destroy() }
    }

    function registerSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addComponent || !Lampa.SettingsApi.addParam) return
        Lampa.SettingsApi.addComponent({ component: NS + 'settings', name: NAME, icon: '' })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'section', type: 'select', values: { movies_new: 'Новинки кино', movies_foreign: 'Зарубежное кино (вкл. HD, UHD)', series_ru: 'Наши сериалы', series_foreign: 'Зарубежные сериалы', doc: 'Документалки и ТВ-бренды', theater: 'Театр и МузВидео' }, default: 'movies_new' }, field: { name: 'Раздел' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'proxy_url', type: 'input', values: '', default: DEFAULT_PROXY_URL }, field: { name: 'URL локального API', description: 'По умолчанию: ' + DEFAULT_PROXY_URL } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'player', type: 'select', values: { auto: 'Авто (MKV/торренты — Android-плеер)', lampa: 'Всегда внутренний плеер LAMPA', android: 'Всегда Android-плеер' }, default: 'auto' }, field: { name: 'Плеер', description: 'Android-плеер корректно читает MKV с DTS/TrueHD' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'torr_url', type: 'input', values: '', default: 'http://127.0.0.1:8090' }, field: { name: 'TorrServer', description: 'Если не задан в настройках LAMPA (по умолчанию: 127.0.0.1:8090)' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'native_cards', type: 'select', values: { on: 'Открывать карточки LAMPA (TMDB)', off: 'Показывать только раздачу' }, default: 'on' }, field: { name: 'Экран карточки' } })
    }

    function addMenuItem() {
        var icon = '<svg><use xlink:href="#sprite-hd"></use></svg>'
        if (Lampa.Menu && Lampa.Menu.addButton) {
            Lampa.Menu.addButton(icon, NAME, function () {
                Lampa.Activity.push({ url: '', title: NAME, component: COMPONENT, page: 1 })
            })
            return
        }
        var btn = $('<li class="menu__item selector"><div class="menu__ico">' + icon + '</div><div class="menu__text">' + NAME + '</div></li>')
        btn.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: NAME, component: COMPONENT, page: 1 })
        })
        var menu = $('.menu .menu__list').eq(0)
        if (menu && menu.length) menu.append(btn)
    }

    function init() {
        try {
            if (Lampa.Component && Lampa.Component.add) {
                if (!Lampa.Component.get || !Lampa.Component.get(COMPONENT)) Lampa.Component.add(COMPONENT, ListScreen)
                if (!Lampa.Component.get || !Lampa.Component.get('lampa_nm_detail')) Lampa.Component.add('lampa_nm_detail', DetailScreen)
            }
        } catch (error) { logError('Не удалось зарегистрировать экраны', error) }
        try { registerSettings() } catch (error) { logError('Настройки недоступны', error) }
        try { addMenuItem() } catch (error) { logError('Не удалось добавить пункт меню', error) }
    }

    if (window.appready) init()
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init() })
})()
