(function () {
    'use strict'

    if (window.lampa_kinozal_proto_ready) return
    window.lampa_kinozal_proto_ready = true

    var NS = 'lampa_kinozal_'
    var COMPONENT = 'lampa_kinozal_proto'
    // Default address of the local API on the home network. It can still be
    // changed in settings if the computer receives another LAN address.
    var DEFAULT_PROXY_URL = 'http://192.168.11.71:8787'
    // TorrServer runs on the TV box itself, so localhost is the default here.
    var DEFAULT_TORR_URL = 'http://127.0.0.1:8090'
    var PAGE_LIMIT = 50

    var TOP_CATEGORIES = [
        { value: 'movies', title: 'Фильмы' },
        { value: 'series', title: 'Сериалы общие' },
        { value: 'series_ru', title: 'Сериалы российские' },
        { value: 'series_foreign', title: 'Сериалы зарубежные' }
    ]
    var TOP_PERIODS = [
        { value: 'week', title: 'За неделю' },
        { value: 'month', title: 'За месяц' }
    ]
    var SAMPLE = [
        {
            id: 'mock-dune-2',
            title: 'Дюна: Часть вторая',
            original_title: 'Dune: Part Two',
            year: 2024,
            type: 'movie',
            overview: 'Фиктивная карточка для проверки интерфейса плагина.',
            quality: '1080p',
            codec: 'H.264',
            audio: 'Русский AC3 5.1 / English',
            size: '8.4 GB',
            duration: '02:46:00',
            seeds: 42,
            peers: 3,
            published_at: '2026-10-27',
            magnet: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000001'
        },
        {
            id: 'mock-arcane',
            title: 'Аркейн — сезон 1',
            original_title: 'Arcane',
            year: 2021,
            type: 'series',
            overview: 'Фиктивная карточка сериала для проверки списка и детализации.',
            quality: '2160p HDR',
            codec: 'HEVC',
            audio: 'Русский дубляж / English',
            size: '24.1 GB',
            duration: '09:10:00',
            seeds: 18,
            peers: 1,
            published_at: '2026-10-26',
            magnet: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000002'
        }
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
        } catch (e) {
            return ''
        }
    }

    function safeMagnet(value) {
        return /^magnet:\?xt=urn:btih:[a-z0-9]{6,}(?:&[^\s]*)?$/i.test(String(value || '')) ? String(value) : ''
    }

    function number(value) {
        var parsed = Number(value)
        return isFinite(parsed) ? parsed : 0
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    }

    function normalize(item) {
        item = item || {}
        return {
            id: String(item.id || item.guid || item.url || item.title || Math.random()),
            title: String(item.title || item.name || 'Без названия'),
            original_title: String(item.original_title || ''),
            year: item.year ? number(item.year) : '',
            type: String(item.type || 'movie'),
            poster: safeHttpUrl(item.poster || item.poster_url || ''),
            overview: String(item.overview || item.description || ''),
            quality: String(item.quality || ''),
            codec: String(item.codec || ''),
            audio: String(item.audio || ''),
            size: String(item.size || ''),
            duration: String(item.duration || ''),
            seeds: number(item.seeds),
            peers: number(item.peers),
            published_at: String(item.published_at || ''),
            source_url: safeHttpUrl(item.source_url || ''),
            magnet: safeMagnet(item.magnet || item.magnet_link || '')
        }
    }

    function parseSearchResponse(response) {
        var data = response
        if (typeof data === 'string') data = JSON.parse(data)
        data = data || {}
        var list = Array.isArray(data.results) ? data.results : (Array.isArray(data.items) ? data.items : [])
        return {
            page: number(data.page) || 1,
            total_pages: number(data.total_pages) || 1,
            results: list.map(normalize)
        }
    }

    function notify(message, error) {
        if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message, error ? { style: 'error', time: 6000 } : undefined)
    }

    function logError(message, error) {
        if (window.console && console.error) console.error('[lampa-kinozal]', message, error || '')
    }

    function MockProvider() {}
    MockProvider.prototype.search = function (query, page, limit, done) {
        var q = String(query || '').toLowerCase().trim()
        var results = SAMPLE.filter(function (item) {
            return !q || (item.title + ' ' + item.original_title).toLowerCase().indexOf(q) >= 0
        }).slice(0, limit)
        setTimeout(function () { done({ page: page, total_pages: 1, results: results.map(normalize) }) }, 80)
    }
    MockProvider.prototype.clear = function () {}

    function ProxyProvider(baseUrl) {
        this.baseUrl = safeHttpUrl(baseUrl).replace(/\/$/, '')
        this.network = new Lampa.Reguest()
        // Browser-backed Kinozal requests can take several seconds on the
        // first uncached request; leave enough time for a TV connection.
        this.network.timeout(15000)
    }
    ProxyProvider.prototype.search = function (query, page, limit, done, fail, options) {
        if (!this.baseUrl) return fail('Не указан адрес локального API')
        options = options || {}
        var url = this.baseUrl + '/v1/search?q=' + encodeURIComponent(query || '') + '&page=' + page + '&limit=' + limit
        if (options.category) url += '&category=' + encodeURIComponent(options.category)
        if (options.period) url += '&period=' + encodeURIComponent(options.period)
        // `silent` avoids a compatibility bug in some LAMPA builds where
        // the loading-overlay path inside `get` calls an undefined `clear`.
        this.network.silent(url, function (response) {
            try { done(parseSearchResponse(response)) } catch (e) { fail('Локальный API вернул неверный JSON') }
        }, function (xhr, exception) {
            fail(this.network.errorDecode ? this.network.errorDecode(xhr, exception) : 'Ошибка локального API')
        }.bind(this))
    }
    ProxyProvider.prototype.clear = function () { this.network.clear() }

    function makeProvider() {
        return field('mode', 'mock') === 'proxy'
            ? new ProxyProvider(field('proxy_url', '') || DEFAULT_PROXY_URL)
            : new MockProvider()
    }

    function makeCardData(item) {
        var card = $.extend({}, item)
        card.poster = card.poster || ''
        card.img = card.img || card.poster || ''
        card.source = card.source || 'kinozal'
        card.params = card.params || {}
        return card
    }

    function selectFilter(title, items, current, onPick) {
        Lampa.Select.show({
            title: title,
            items: items,
            onSelect: function (item) {
                Lampa.Select.close()
                onPick(item.value)
            },
            // Select.close() уже вызывает onBack — повторный close здесь
            // даёт бесконечную рекурсию (Maximum call stack size exceeded).
            onBack: function () { Lampa.Controller.toggle('content') }
        })
    }

    /*
     * Ищем раздачу в TMDB руками самой LAMPA (её собственный ключ) и
     * открываем штатный экран карточки. Если не нашли — наш экран деталей.
     */
    function cleanQuery(value) {
        return String(value || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ') // хвосты вида «(1-12 серии из 12)», «(2024)»
            .replace(/\s+/g, ' ')
            .trim()
    }

    function collectSearchGroups(response) {
        // Новые сборки: {movie: {...}, tv: {...}}, старые: массив групп.
        if (Array.isArray(response)) return response
        if (response && typeof response === 'object') {
            return [response.movie, response.tv].filter(Boolean)
        }
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
            }, function () {
                trySearch(index + 1)
            })
        }

        trySearch(0)
    }

    function openFallbackDetail(item) {
        Lampa.Activity.push({ url: '', title: item.title, component: 'lampa_kinozal_detail', item: item, page: 1 })
    }

    function pushScreen(category, period) {
        Lampa.Activity.push({ url: '', title: 'Кинозал', component: COMPONENT, page: 1, category: category, period: period })
    }

    /*
     * Меню фильтров: открывается уходом вправо за последнюю карточку.
     * Первый уровень — что меняем, второй — выбор значения.
     */
    function openFilterMenu(category, period) {
        var categoryItem = TOP_CATEGORIES.filter(function (item) { return item.value === category })[0] || TOP_CATEGORIES[0]
        var periodItem = TOP_PERIODS.filter(function (item) { return item.value === period })[0] || TOP_PERIODS[0]

        Lampa.Select.show({
            title: 'Кинозал',
            items: [
                { title: 'Раздел', subtitle: categoryItem.title },
                { title: 'Период', subtitle: periodItem.title }
            ],
            onSelect: function (item) {
                Lampa.Select.close()
                if (item.title === 'Раздел') {
                    selectFilter('Раздел топа', TOP_CATEGORIES, category, function (value) {
                        pushScreen(value, period)
                    })
                } else {
                    selectFilter('Период топа', TOP_PERIODS, period, function (value) {
                        pushScreen(category, value)
                    })
                }
            },
            // Select.close() уже вызывает onBack — повторный close здесь
            // даёт бесконечную рекурсию (Maximum call stack size exceeded).
            onBack: function () { Lampa.Controller.toggle('content') }
        })
    }

    /*
     * LAMPA 3.x: штатный экран-категория (сетка карточек, вертикальная
     * прокрутка, пагинация при доскролле, контроллер content).
     */
    function MakerScreen(object) {
        var provider = makeProvider()
        var query = String(object.query || '')
        var category = String(object.category || field('category', 'movies'))
        var period = String(object.period || field('period', 'week'))

        var comp = Lampa.Maker.make('Category', {
            title: 'Кинозал',
            page: number(object.page) || 1
        })

        function loadPage(page, resolve, reject) {
            provider.search(query, page, PAGE_LIMIT, function (data) {
                if (resolve) resolve(data)
                else comp.build({
                    results: data.results.map(makeCardData),
                    total_pages: data.total_pages
                })
            }, function (message) {
                notify(message, true)
                if (reject) reject()
                else comp.empty()
            }, { category: category, period: period })
        }

        comp.use({
            onCreate: function () {
                loadPage(number(object.page) || 1)
            },
            // Вправо за последнюю карточку — открываем меню фильтров.
            onController: function (controller) {
                controller.right = function () {
                    if (Lampa.Navigator && Lampa.Navigator.canmove && Lampa.Navigator.canmove('right')) Lampa.Navigator.move('right')
                    else if (window.Navigator && window.Navigator.canmove('right')) window.Navigator.move('right')
                    else openFilterMenu(category, period)
                }
            },
            onNext: function (resolve, reject) {
                loadPage(number(this.object.page) || 1, resolve, reject)
            },
            onInstance: function (card, data) {
                card.use({
                    onlyEnter: function () {
                        openCard(data)
                    }
                })
            }
        })

        return comp
    }

    /*
     * LAMPA 2.x: классический экран категории — сетка category-full,
     * карточки Lampa.Card, контроллер content в start().
     */
    function LegacyScreen(object) {
        var provider = makeProvider()
        var query = String(object.query || '')
        var category = String(object.category || field('category', 'movies'))
        var period = String(object.period || field('period', 'week'))
        var page = number(object.page) || 1

        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250, end_ratio: 2 })
        var body = $('<div class="category-full"></div>')
        var html = document.createElement('div')
        var items = []
        var total_pages = 1
        var last = false
        var waitload = false
        var active = 0

        function appendCards(data) {
            data.results.forEach(function (element) {
                var card
                try {
                    card = new Lampa.Card(element, { object: object })
                } catch (e) {
                    card = new Lampa.Card($.extend({ title: element.title }, element))
                }
                card.create()
                card.onFocus = function (target) {
                    last = target
                    active = items.indexOf(card)
                    scroll.update(target)
                }
                card.onTouch = function (target) {
                    last = target
                    active = items.indexOf(card)
                }
                card.onEnter = function () {
                    openCard(element)
                }
                body.append(card.render(true))
                items.push(card)
            })
        }

        function nav() {
            return (Lampa.Navigator && Lampa.Navigator.canmove) ? Lampa.Navigator : window.Navigator
        }

        function limitView() {
            var limit_view = 12
            var limit_collection = 36
            var collection = items.slice(Math.max(0, active - limit_view), active + limit_view)

            items.forEach(function (item) {
                item.render(true).toggleClass('layer--render', collection.indexOf(item) >= 0)
            })

            if (nav().setCollection) {
                nav().setCollection(items.slice(Math.max(0, active - limit_collection), active + limit_collection).map(function (c) { return c.render(true) }))
                nav().focused(last)
            }

            if (Lampa.Layer && Lampa.Layer.visible) Lampa.Layer.visible(scroll.render(true))
        }

        function nextPage() {
            if (waitload || page >= total_pages) return
            waitload = true
            page++
            provider.search(query, page, PAGE_LIMIT, function (data) {
                total_pages = data.total_pages || total_pages
                appendCards(data)
                waitload = false
                limitView()
            }, function () { waitload = false }, { category: category, period: period })
        }

        function build(data) {
            if (!data.results.length) return empty()

            total_pages = data.total_pages || 1

            scroll.minus()
            scroll.onEnd = nextPage
            scroll.onScroll = limitView
            scroll.onWheel = function (step) {
                if (!Lampa.Controller.own(LegacyScreen_instance)) startController()
                nav().move(step > 0 ? 'down' : 'up')
            }

            appendCards(data)

            scroll.append(body)
            $(html).append(scroll.render(true))

            limitView()

            this.activity.loader(false)
            this.activity.toggle()
        }

        function empty() {
            var hint = $('<div style="padding:2em;color:#fff;opacity:.7">Ничего не найдено. Проверьте адрес локального API в настройках плагина.</div>')
            scroll.append(hint)
            $(html).append(scroll.render(true))
            this.activity.loader(false)
            this.activity.toggle()
        }

        function load() {
            this.activity.loader(true)
            provider.search(query, page, PAGE_LIMIT, function (data) {
                build.call(LegacyScreen_instance, data)
            }, function (message) {
                notify(message, true)
                empty.call(LegacyScreen_instance)
            }, { category: category, period: period })
        }

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
                    else openFilterMenu(category, period)
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

        var LegacyScreen_instance = this

        this.create = function () { load(); return this.render() }
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

    /*
     * Экран деталей раздачи — резервный путь, когда TMDB-поиск не сработал.
     * Штатный контроллер LAMPA работает только с элементами, добавленными в
     * `Lampa.Scroll` как `selector`; для кнопок используется готовый шаблон
     * `settings_params` (там уже есть focus/enter и стили подсветки).
     */
    function DetailScreen(object) {
        var item = normalize(object.item)
        var scroll = new Lampa.Scroll({ mask: true, over: true })
        var last = false
        var torr = new TorrAdapter(field('torr_url', '') || DEFAULT_TORR_URL)
        var body = $('<div class="settings-body"></div>')

        var head = $('<h2 style="color:#fff;font-size:1.6em;margin:1em 1.5em .5em">' + escapeHtml(item.title) + '</h2>')
        if (item.original_title) head.append('<div style="opacity:.6;font-size:.7em">' + escapeHtml(item.original_title) + '</div>')
        body.append(head)

        if (item.poster) {
            body.append('<div style="margin:0 1.5em"><img src="' + escapeHtml(item.poster) + '" style="width:11em;border-radius:.4em;float:left;margin-right:1.2em"></div>')
        }

        var meta = [item.year, item.quality, item.codec, item.size].filter(Boolean).join(' · ')
        if (meta) body.append('<p style="color:#fff;opacity:.8;margin:.5em 1.5em;clear:left">' + escapeHtml(meta) + '</p>')
        if (item.overview) body.append('<p style="color:#fff;opacity:.85;line-height:1.45;margin:.5em 1.5em;clear:left">' + escapeHtml(item.overview) + '</p>')

        body.append('<p style="color:#fff;opacity:.85;margin:.5em 1.5em;clear:left">' + escapeHtml([
            'Аудио: ' + (item.audio || '—'),
            'Длительность: ' + (item.duration || '—'),
            'Сиды: ' + item.seeds,
            'Пиры: ' + item.peers
        ].join(' · ')) + '</p>')

        function addButton(name, callback) {
            var btn = $('<div class="settings-param selector"><div class="settings-param-name">' + escapeHtml(name) + '</div></div>')
            btn.on('hover:focus', function () {
                last = btn
                scroll.update(btn)
            })
            btn.on('hover:enter', callback)
            body.append(btn)
        }

        addButton('Передать в TorrServer', function () {
            torr.send(item, function () { notify('Раздача передана') }, function (message) { notify(message, true) })
        })

        addButton('Показать magnet', function () {
            if (!item.magnet) return notify('У карточки нет magnet', true)
            Lampa.Modal.open({
                title: 'Magnet-ссылка',
                html: $('<div></div>').text(item.magnet),
                size: 'medium',
                buttons: [{ name: 'Закрыть', onSelect: function () { Lampa.Modal.close() } }],
                onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('content') }
            })
        })

        scroll.append(body)

        function nav() {
            return (Lampa.Navigator && Lampa.Navigator.canmove) ? Lampa.Navigator : window.Navigator
        }

        function startController() {
            Lampa.Controller.add('content', {
                link: this,
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(true))
                    Lampa.Controller.collectionFocus(last || body.find('.selector').first(), scroll.render(true))
                },
                up: function () {
                    if (nav().canmove('up')) nav().move('up')
                    else Lampa.Controller.toggle('head')
                },
                down: function () {
                    if (nav().canmove('down')) nav().move('down')
                },
                left: function () { Lampa.Controller.toggle('menu') },
                right: function () { Lampa.Controller.toggle('content') },
                back: function () { Lampa.Activity.backward() }
            })

            Lampa.Controller.toggle('content')
        }

        this.create = function () { return this.render() }
        this.render = function () { return scroll.render() }
        this.start = startController
        this.stop = function () {}
        this.pause = function () {}
        this.destroy = function () { torr.clear(); scroll.destroy() }
    }

    function TorrAdapter(endpoint) {
        this.endpoint = safeHttpUrl(endpoint).replace(/\/$/, '')
        this.network = new Lampa.Reguest()
        this.network.timeout(15000)
    }
    TorrAdapter.prototype.send = function (item, done, fail) {
        if (!this.endpoint) return fail('Не указан адрес TorrServer')
        if (!item.magnet) return fail('У карточки нет корректной magnet-ссылки')
        this.network.silent(this.endpoint + '/v1/torrents', done, function () {
            fail('TorrServer не принял раздачу')
        }, {
            magnet: item.magnet,
            title: item.title,
            poster: item.poster || ''
        })
    }
    TorrAdapter.prototype.clear = function () { this.network.clear() }

    function registerSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addComponent || !Lampa.SettingsApi.addParam) return
        Lampa.SettingsApi.addComponent({ component: NS + 'settings', name: 'Кинозал — прототип', icon: '' })
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: NS + '_open_settings', type: 'button' },
            field: { name: 'Кинозал — прототип', description: 'Настройки источника топов Kinozal' },
            onChange: function () {
                if (Lampa.Settings && Lampa.Settings.create) {
                    Lampa.Settings.create(NS + 'settings', { onBack: function () { Lampa.Settings.create('more') } })
                }
            }
        })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'mode', type: 'select', values: { mock: 'mock', proxy: 'proxy' }, default: 'mock' }, field: { name: 'Источник данных', description: 'mock не делает сетевых запросов' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'proxy_url', type: 'input', values: '', default: DEFAULT_PROXY_URL }, field: { name: 'URL локального API', description: 'По умолчанию: ' + DEFAULT_PROXY_URL } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'torr_url', type: 'input', values: '', default: DEFAULT_TORR_URL }, field: { name: 'URL TorrServer', description: 'По умолчанию: ' + DEFAULT_TORR_URL } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'native_cards', type: 'select', values: { on: 'Открывать карточки LAMPA (TMDB)', off: 'Показывать только раздачу' }, default: 'on' }, field: { name: 'Экран карточки', description: 'TMDB-поиск выполняет сама LAMPA своим ключом' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'category', type: 'select', values: { movies: 'Фильмы', series: 'Сериалы общие', series_ru: 'Сериалы российские', series_foreign: 'Сериалы зарубежные' }, default: 'movies' }, field: { name: 'Раздел топа' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'period', type: 'select', values: { week: 'За неделю', month: 'За месяц' }, default: 'week' }, field: { name: 'Период топа' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'limit', type: 'select', values: { '5': '5', '10': '10', '20': '20' }, default: '10' }, field: { name: 'Результатов на странице поиска' } })
    }

    function addMenuItem() {
        var icon = '<svg><use xlink:href="#sprite-movie"></use></svg>'
        var menu = $('.menu .menu__list').eq(0)
        if (menu && menu.length) {
            var btn = $('<li class="menu__item selector"><div class="menu__ico">' + icon + '</div><div class="menu__text">Кинозал</div></li>')
            btn.on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: 'Кинозал', component: COMPONENT, page: 1 })
            })
            menu.append(btn)
        } else if (Lampa.Menu && Lampa.Menu.addButton) {
            Lampa.Menu.addButton(icon, 'Кинозал', function () {
                Lampa.Activity.push({ url: '', title: 'Кинозал', component: COMPONENT, page: 1 })
            })
        }
    }

    function init() {
        try {
            if (Lampa.Component && Lampa.Component.add) {
                if (!Lampa.Component.get || !Lampa.Component.get(COMPONENT)) Lampa.Component.add(COMPONENT, ListScreen)
                if (!Lampa.Component.get || !Lampa.Component.get('lampa_kinozal_detail')) Lampa.Component.add('lampa_kinozal_detail', DetailScreen)
            }
        } catch (error) { logError('Не удалось зарегистрировать экраны', error) }
        try { registerSettings() } catch (error) { logError('Настройки недоступны в этой версии LAMPA', error) }
        try { addMenuItem() } catch (error) { logError('Не удалось добавить пункт меню', error) }
    }

    if (window.appready) init()
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init() })
})()
