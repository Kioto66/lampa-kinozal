(function () {
    'use strict'

    if (window.lampa_nm_ready) return
    window.lampa_nm_ready = true

    var NS = 'lampa_nm_'
    var COMPONENT = 'lampa_nm_list'
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
        Lampa.Activity.push({ url: '', title: 'NM', component: COMPONENT, page: 1, section: section })
    }

    function openSectionMenu(current) {
        var currentTitle = (SECTIONS.filter(function (s) { return s.value === current })[0] || SECTIONS[0]).title
        Lampa.Select.show({
            title: 'NM — разделы',
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

        var comp = Lampa.Maker.make('Category', { title: 'NM', page: 1 })

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
            var hint = $('<div style="padding:2em;color:#fff;opacity:.7">Ничего не получено. Проверьте адрес локального API в настройках плагина NM.</div>')
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

        var VIDEO_EXT = ['mp4', 'mkv', 'avi', 'ts', 'm2ts', 'mov', 'flv', 'webm', 'wmv', 'mpg', 'mpeg', 'm4v', 'vob']

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

        function playFile(base, hash, file, files) {
            var index = typeof file.id !== 'undefined' ? file.id : files.indexOf(file)
            var url = base + '/stream/' + encodeURIComponent(shortName(file.path)) + '?link=' + hash + '&index=' + index + '&play'

            Lampa.Player.play({ title: item.title, url: url })
            Lampa.Player.callback(function () { Lampa.Controller.toggle('content') })
            Lampa.Player.playlist(files.map(function (f) {
                var findex = typeof f.id !== 'undefined' ? f.id : files.indexOf(f)
                return { title: shortName(f.path), url: base + '/stream/' + encodeURIComponent(shortName(f.path)) + '?link=' + hash + '&index=' + findex + '&play' }
            }))
        }

        function watch(magnet) {
            var base = torrBase()
            if (!base) return notify('Не указан адрес TorrServer (настройки LAMPA или плагина NM)', true)
            if (!Lampa.Player || !Lampa.Player.play) return notify('Плеер LAMPA недоступен в этой версии', true)

            notify('Добавляю раздачу в TorrServer…')

            var network = new Lampa.Reguest()
            network.timeout(30000)

            function fail(message) { notify(typeof message === 'string' ? message : 'TorrServer не принял раздачу', true) }

            network.silent(base + '/torrents', function (torrent) {
                var hash = torrent && torrent.hash
                if (!hash) return fail()

                network.silent(base + '/torrents', function (json) {
                    var files = ((json || {}).file_stats || []).filter(function (f) {
                        return VIDEO_EXT.indexOf(String(f.path).split('.').pop().toLowerCase()) >= 0
                    })
                    if (!files.length) return notify('В раздаче нет видеофайлов', true)

                    files.sort(naturalSort)

                    if (files.length === 1) return playFile(base, hash, files[0], files)

                    Lampa.Select.show({
                        title: 'Файлы раздачи',
                        items: files.map(function (f) { return { title: shortName(f.path), file: f } }),
                        onSelect: function (selected) {
                            Lampa.Select.close()
                            playFile(base, hash, selected.file, files)
                        },
                        onBack: function () { Lampa.Select.close(); Lampa.Controller.toggle('content') }
                    })
                }, fail, JSON.stringify({ action: 'get', hash: hash }))
            }, fail, JSON.stringify({
                action: 'add',
                link: magnet,
                title: item.title,
                poster: item.poster || '',
                save_to_db: false,
                category: item.type === 'series' ? 'tv' : 'movie'
            }))
        }

        var content = $('<div style="padding:2em 3em;max-width:60em;color:#fff"></div>')
        content.append($('<h2></h2>').text(item.title))
        if (item.original_title) content.append($('<p style="opacity:.7"></p>').text(item.original_title))
        if (item.poster) content.append($('<img style="float:left;margin:0 1.2em 1em 0;width:11em;border-radius:.4em" />').attr('src', item.poster))
        if (item.year) content.append($('<p></p>').text(item.year))
        if (item.overview) content.append($('<p style="opacity:.85;line-height:1.45"></p>').text(item.overview))

        var actions = $('<div style="margin-top:1em;clear:both"></div>')

        function action(name, callback) {
            var el = $('<div class="selector" style="display:block;min-height:3.2em;padding:.65em .8em;margin:.45em 0;background:rgba(255,255,255,.06);border-radius:.35em"></div>').text(name)
            el.on('hover:focus', function () { last = el })
            el.on('hover:enter', callback)
            actions.append(el)
        }

        if (item.magnet) action('Смотреть (TorrServer)', function () { watch(item.magnet) })

        if (item.source_url) {
            action('Открыть страницу раздачи', function () {
                if (Lampa.Open && Lampa.Open.newWindow) Lampa.Open.newWindow(item.source_url)
                else window.open(item.source_url, '_blank')
            })
        }

        content.append(actions)
        scroll.append(content)

        function startController() {
            Lampa.Controller.add('content', {
                link: this,
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(true))
                    Lampa.Controller.collectionFocus(last || false, scroll.render(true))
                },
                up: function () {
                    if (Lampa.Navigator && Lampa.Navigator.canmove) Lampa.Navigator.move('up')
                    else if (window.Navigator && window.Navigator.canmove) window.Navigator.move('up')
                },
                down: function () {
                    if (Lampa.Navigator && Lampa.Navigator.canmove) Lampa.Navigator.move('down')
                    else if (window.Navigator && window.Navigator.canmove) window.Navigator.move('down')
                },
                left: function () {},
                right: function () {},
                back: function () { Lampa.Activity.backward() }
            })
            Lampa.Controller.toggle('content')
        }

        this.create = function () { return this.render() }
        this.render = function () { return scroll.render() }
        this.start = startController
        this.stop = function () {}
        this.pause = function () {}
        this.destroy = function () { scroll.destroy() }
    }

    function registerSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addComponent || !Lampa.SettingsApi.addParam) return
        Lampa.SettingsApi.addComponent({ component: NS + 'settings', name: 'NM — NNM-Club', icon: '' })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'section', type: 'select', values: { movies_new: 'Новинки кино', movies_foreign: 'Зарубежное кино (вкл. HD, UHD)', series_ru: 'Наши сериалы', series_foreign: 'Зарубежные сериалы', doc: 'Документалки и ТВ-бренды', theater: 'Театр и МузВидео' }, default: 'movies_new' }, field: { name: 'Раздел' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'proxy_url', type: 'input', values: '', default: DEFAULT_PROXY_URL }, field: { name: 'URL локального API', description: 'По умолчанию: ' + DEFAULT_PROXY_URL } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'torr_url', type: 'input', values: '', default: 'http://127.0.0.1:8090' }, field: { name: 'TorrServer', description: 'Если не задан в настройках LAMPA (по умолчанию: 127.0.0.1:8090)' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'native_cards', type: 'select', values: { on: 'Открывать карточки LAMPA (TMDB)', off: 'Показывать только раздачу' }, default: 'on' }, field: { name: 'Экран карточки' } })
    }

    function addMenuItem() {
        var btn = $('<li class="menu__item selector"><div class="menu__ico"></div><div class="menu__text">NM</div></li>')
        btn.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'NM', component: COMPONENT, page: 1 })
        })
        var menu = $('.menu .menu__list').eq(0)
        if (menu && menu.length) menu.append(btn)
        else if (Lampa.Menu && Lampa.Menu.addButton) {
            Lampa.Menu.addButton('', 'NM', function () {
                Lampa.Activity.push({ url: '', title: 'NM', component: COMPONENT, page: 1 })
            })
        }
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
