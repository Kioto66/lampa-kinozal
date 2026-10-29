(function () {
    'use strict'

    if (window.lampa_pl_ready) return
    window.lampa_pl_ready = true

    var NS = 'lampa_pl_'
    var COMPONENT = 'lampa_pl_list'
    var NAME = 'Pornolab'
    var DEFAULT_PROXY_URL = 'http://192.168.11.71:8787'
    var PAGE_LIMIT = 50

    var SECTIONS = [
        { value: 'week', title: 'Популярное за неделю' },
        { value: 'month', title: 'Популярное за месяц' },
        { value: 'siterips', title: 'Сайтрипы 2026' },
        { value: 'siterips_ru', title: 'Сайтрипы с русскими актрисами 2026' }
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

    function number(value) {
        var parsed = Number(value)
        return isFinite(parsed) ? parsed : 0
    }

    function normalize(item) {
        item = item || {}
        return {
            id: String(item.id || item.title || Math.random()),
            pl_id: number(item.pl_id),
            title: String(item.title || item.name || 'Без названия'),
            year: item.year ? number(item.year) : '',
            type: 'movie',
            poster: safeHttpUrl(item.poster || ''),
            overview: String(item.overview || ''),
            size: String(item.size || ''),
            seeds: number(item.seeds),
            source_url: safeHttpUrl(item.source_url || ''),
            magnet: ''
        }
    }

    function notify(message, error) {
        if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message, error ? { style: 'error', time: 6000 } : undefined)
    }

    function logError(message, error) {
        if (window.console && console.error) console.error('[lampa-pl]', message, error || '')
    }

    function Provider(baseUrl) {
        this.baseUrl = safeHttpUrl(baseUrl).replace(/\/$/, '')
        this.network = new Lampa.Reguest()
        this.network.timeout(45000)
    }
    Provider.prototype.list = function (section, done, fail) {
        if (!this.baseUrl) return fail('Не указан адрес локального API')
        var url = this.baseUrl + '/pl/v1/list?section=' + encodeURIComponent(section) + '&limit=' + PAGE_LIMIT
        this.network.silent(url, function (response) {
            try {
                var data = typeof response === 'string' ? JSON.parse(response) : response
                data.results = (data.results || []).map(normalize)
                done(data)
            } catch (e) { fail('Локальный API вернул неверный JSON') }
        }, function (xhr, exception) {
            fail(this.network.errorDecode ? this.network.errorDecode(xhr, exception) : 'Ошибка локального API')
        }.bind(this))
    }
    Provider.prototype.card = function (plId) {
        var self = this
        return new Promise(function (resolve, reject) {
            var url = self.baseUrl + '/pl/v1/card?t=' + encodeURIComponent(plId)
            self.network.silent(url, function (response) {
                try { resolve(typeof response === 'string' ? JSON.parse(response) : response) } catch (e) { reject(new Error('Неверный JSON карточки')) }
            }, function () { reject(new Error('Не удалось получить данные темы')) })
        })
    }
    /*
     * Лёгкая карточка (только постер/описание, анонимно на сервере).
     * Свой Reguest на вызов — общий инстанс ставит запросы в очередь,
     * и догрузка 50 постеров растягивалась на минуты.
     */
    Provider.prototype.cardLight = function (plId) {
        var self = this
        return new Promise(function (resolve, reject) {
            var network = new Lampa.Reguest()
            network.timeout(30000)
            var url = self.baseUrl + '/pl/v1/card?t=' + encodeURIComponent(plId) + '&light=1'
            network.silent(url, function (response) {
                network.clear()
                try { resolve(typeof response === 'string' ? JSON.parse(response) : response) } catch (e) { reject(new Error('Неверный JSON карточки')) }
            }, function () {
                network.clear()
                reject(new Error('Не удалось получить постер'))
            })
        })
    }
    Provider.prototype.clear = function () { this.network.clear() }

    function makeCardData(item) {
        var card = $.extend({}, item)
        card.poster = card.poster || ''
        card.img = card.img || card.poster || ''
        card.source = card.source || 'pl'
        card.params = card.params || {}
        return card
    }

    // TMDB взрослый контент не индексирует — всегда свой экран деталей.
    function openCard(item) {
        Lampa.Activity.push({ url: '', title: item.title, component: 'lampa_pl_detail', item: item, page: 1 })
    }

    function pushScreen(section) {
        Lampa.Activity.push({ url: '', title: NAME, component: COMPONENT, page: 1, section: section })
    }

    function openSectionMenu(current) {
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
        var section = String(object.section || field('section', 'week'))

        // Ленивая догрузка постеров: 3 параллельные цепочки лёгких запросов.
        var chains = [Promise.resolve(), Promise.resolve(), Promise.resolve()]
        var chainIdx = 0
        var posterBudget = 50

        function setPoster(card, data, poster) {
            data.poster = poster
            data.img = poster
            try {
                var el = card.render(true)
                var img = el.querySelector ? el.querySelector('.card__img') : null
                if (img) img.src = poster
                else $(el).find('.card__img').attr('src', poster)
            } catch (e) { }
            // Карточка при 'visible' перетирает src из data — к этому моменту
            // data.poster уже новый, но перестраховка на случай гонки не помешает
            setTimeout(function () {
                try {
                    var el2 = card.render(true)
                    var img2 = el2.querySelector ? el2.querySelector('.card__img') : null
                    if (img2 && img2.src !== poster) img2.src = poster
                } catch (e) { }
            }, 2500)
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
                // Постеры лежат внутри тем — догружаем лениво, до 50 карточек
                if (data.pl_id && !data.poster && posterBudget > 0) {
                    posterBudget--
                    var idx = chainIdx++ % chains.length
                    chains[idx] = chains[idx].then(function () {
                        return provider.cardLight(data.pl_id).then(function (info) {
                            if (info.poster) setPoster(card, data, info.poster)
                            if (info.overview && !data.overview) data.overview = info.overview
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
        var section = String(object.section || field('section', 'week'))

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
                card.onFocus = function (target) { last = target; active = items.indexOf(card); scroll.update(target) }
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
                if (!data.results.length) return empty.call(instance)
                scroll.minus()
                appendCards(data)
                scroll.append(body)
                $(html).append(scroll.render(true))
                limitView()
                instance.activity.loader(false)
                instance.activity.toggle()
            }, function (message) {
                notify(message, true)
                empty.call(instance)
            })
            return this.render()
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
        var magnet = item.magnet || ''

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

        var mode = 'detail'
        var filesState = null
        var closed = false

        function playFile(base, hash, file, files) {
            var index = typeof file.id !== 'undefined' ? file.id : files.indexOf(file)
            var name = shortName(file.path)
            if (closed) return

            var url
            if (Lampa.Torserver && Lampa.Torserver.stream) {
                url = Lampa.Torserver.stream(name, hash, index).replace('&preload', '&play')
            } else {
                url = base + '/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + index + '&play'
            }

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

        function watch(magnet) {
            var base = torrBase()
            if (!base) return notify('Не указан адрес TorrServer (настройки LAMPA или плагина ' + NAME + ')', true)
            if (!Lampa.Player || !Lampa.Player.play) return notify('Плеер LAMPA недоступен в этой версии', true)

            notify('Добавляю раздачу в TorrServer…')

            var network = new Lampa.Reguest()
            network.timeout(30000)

            function fail(message) { notify(typeof message === 'string' ? message : 'TorrServer не принял раздачу', true) }

            function openFiles(files) {
                files.sort(naturalSort)
                if (files.length === 1) return playFile(base, hash, files[0], files)

                // Экран списка файлов внутри карточки: Lampa.Select на большом
                // списке подвешивал слабые ТВ-устройства.
                mode = 'files'
                filesState = { base: base, hash: hash, files: files }
                body.empty()
                body.append($('<h2 style="color:#fff;font-size:1.4em;margin:1em 1.5em .5em">Файлы раздачи (' + files.length + ')</h2>'))
                files.slice(0, 300).forEach(function (f) {
                    var btn = $('<div class="settings-param selector"><div class="settings-param-name">' + escapeHtml(shortName(f.path)) + '</div><div class="settings-param-value">' + (Number(f.length) > 1073741824 ? (f.length / 1073741824).toFixed(2) + ' GB' : (f.length / 1048576).toFixed(0) + ' MB') + '</div></div>')
                    btn.on('hover:focus', function () { scroll.update(btn) })
                    btn.on('hover:enter', function () { playFile(base, hash, f, files) })
                    body.append(btn)
                })
                scroll.reset()
                Lampa.Controller.toggle('content')
            }

            network.silent(base + '/torrents', function (torrent) {
                hash = torrent && torrent.hash
                if (!hash) return fail()

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
                category: 'movie'
            }))
        }

        var hash = ''

        function buildDetail() {
            body.empty()

            var head = item.title
                ? $('<h2 style="color:#fff;font-size:1.6em;margin:1em 1.5em .5em">' + escapeHtml(item.title) + '</h2>')
                : $('<h2 style="color:#fff;font-size:1.6em;margin:1em 1.5em .5em">Раздача недоступна</h2>')
            body.append(head)

            if (item.poster) {
                body.append('<div style="margin:0 1.5em"><img src="' + escapeHtml(item.poster) + '" style="width:11em;border-radius:.4em;float:left;margin-right:1.2em"></div>')
            }

            var meta = [item.year, item.size].filter(Boolean).join(' · ')
            if (meta) body.append('<p style="color:#fff;opacity:.8;margin:.5em 1.5em;clear:left">' + escapeHtml(meta) + '</p>')
            if (item.seeds) body.append('<p style="color:#fff;opacity:.8;margin:.5em 1.5em;clear:left">Сидов: ' + item.seeds + '</p>')
            if (item.overview) body.append('<p style="color:#fff;opacity:.85;line-height:1.45;margin:.5em 1.5em;clear:left">' + escapeHtml(item.overview) + '</p>')

            if (!item.pl_id) {
                body.append('<p style="color:#fff;opacity:.85;margin:1em 1.5em">Данные раздачи не сохранились после перезапуска LAMPA. Нажмите влево, чтобы открыть главное меню, или вправо — чтобы выбрать раздел ' + NAME + '.</p>')
            }

            function addWatchStyle() {
                if (window.lampa_pl_watch_style) return
                window.lampa_pl_watch_style = true
                $('<style>').text('.pl-watch{background:#3d7dd8;color:#fff;opacity:.8}.pl-watch.focus{background:#fff;color:#000;opacity:1}').appendTo('head')
            }

            if (item.pl_id) {
                addWatchStyle()
                var watchBtn = $('<div class="simple-button selector pl-watch" style="margin:1em 1.5em;display:inline-flex">&#9654; Смотреть (TorrServer)</div>')
                watchBtn.on('hover:focus', function () {
                    last = watchBtn
                    scroll.update(watchBtn)
                })
                watchBtn.on('hover:enter', function () {
                    if (magnet) return watch(magnet)
                    notify('Получаю данные раздачи с Pornolab…')
                    providerCard(function (info) {
                        if (info.magnet) {
                            magnet = info.magnet
                            if (info.poster && !item.poster) { item.poster = info.poster; buildDetail() }
                            watch(info.magnet)
                        } else {
                            if (info.poster && !item.poster) { item.poster = info.poster; buildDetail() }
                            notify('Не удалось получить магнит (нет авторизации в проектном Chrome или раздача недоступна)', true)
                        }
                    }, function (message) { notify(message, true) })
                })
                body.append(watchBtn)
            }
        }

        var provider = new Provider(field('proxy_url', '') || DEFAULT_PROXY_URL)

        function providerCard(done, fail) {
            provider.card(item.pl_id).then(done, fail)
        }

        // Догружаем полные данные темы (магнит, постер, описание)
        if (item.pl_id) {
            providerCard(function (info) {
                if ((info.poster && !item.poster) || (info.overview && !item.overview)) {
                    if (info.poster && !item.poster) item.poster = info.poster
                    if (info.overview && !item.overview) item.overview = info.overview
                    buildDetail()
                }
                if (info.magnet) magnet = info.magnet
            }, function () { })
        }

        scroll.append(body)
        buildDetail()

        function startController() {
            try {
                Lampa.Controller.add('content', {
                    link: this,
                    toggle: function () {
                        Lampa.Controller.collectionSet(scroll.render(true))
                        Lampa.Controller.collectionFocus(last || body.find('.selector').first(), scroll.render(true))
                    },
                    left: function () { Lampa.Controller.toggle('menu') },
                    right: function () { openSectionMenu(field('section', 'week')) },
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
                        if (mode === 'files') {
                            mode = 'detail'
                            filesState = null
                            last = false
                            buildDetail()
                            scroll.reset()
                            Lampa.Controller.toggle('content')
                        }
                        else Lampa.Activity.backward()
                    }
                })
                Lampa.Controller.toggle('content')
            } catch (e) {
                logError('startController', e)
                Lampa.Noty.show(NAME + ' detail error: ' + e.message, true)
            }
        }

        this.create = function () {
            var result = this.render()
            // Страховка: если LAMPA не вызовет start(), контроллер всё равно зарегистрирован
            startController.call(this)
            return result
        }
        this.render = function () { return scroll.render() }
        this.start = function () { startController.call(this) }
        this.stop = function () {}
        this.pause = function () {}
        this.destroy = function () { closed = true; scroll.destroy() }
    }

    function registerSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addComponent || !Lampa.SettingsApi.addParam) return
        Lampa.SettingsApi.addComponent({ component: NS + 'settings', name: NAME, icon: '' })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'section', type: 'select', values: { week: 'Популярное за неделю', month: 'Популярное за месяц', siterips: 'Сайтрипы 2026', siterips_ru: 'Сайтрипы с русскими актрисами 2026' }, default: 'week' }, field: { name: 'Раздел' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'proxy_url', type: 'input', values: '', default: DEFAULT_PROXY_URL }, field: { name: 'URL локального API', description: 'По умолчанию: ' + DEFAULT_PROXY_URL } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'player', type: 'select', values: { auto: 'Авто (MKV/торренты — Android-плеер)', lampa: 'Всегда внутренний плеер LAMPA', android: 'Всегда Android-плеер' }, default: 'auto' }, field: { name: 'Плеер', description: 'Android-плеер корректно читает MKV с DTS/TrueHD' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'torr_url', type: 'input', values: '', default: 'http://127.0.0.1:8090' }, field: { name: 'TorrServer', description: 'Если не задан в настройках LAMPA' } })
    }

    function addMenuItem() {
        var icon = '<svg><use xlink:href="#sprite-adult"></use></svg>'
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
                if (!Lampa.Component.get || !Lampa.Component.get('lampa_pl_detail')) Lampa.Component.add('lampa_pl_detail', DetailScreen)
            }
        } catch (error) { logError('Не удалось зарегистрировать экраны', error) }
        try { registerSettings() } catch (error) { logError('Настройки недоступны', error) }
        try { addMenuItem() } catch (error) { logError('Не удалось добавить пункт меню', error) }
    }

    if (window.appready) init()
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init() })
})()
