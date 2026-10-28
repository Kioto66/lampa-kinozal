(function () {
    'use strict'

    if (window.lampa_kinozal_proto_ready) return
    window.lampa_kinozal_proto_ready = true

    var NS = 'lampa_kinozal_'
    var COMPONENT = 'lampa_kinozal_proto'
    // Default address of the local API on the home network. It can still be
    // changed in settings if the computer receives another LAN address.
    var DEFAULT_PROXY_URL = 'http://192.168.11.71:8787'
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
        // ListScreen already controls its own loader.
        this.network.silent(url, function (response) {
            try { done(parseSearchResponse(response)) } catch (e) { fail('Локальный API вернул неверный JSON') }
        }, function (xhr, exception) {
            fail(this.network.errorDecode ? this.network.errorDecode(xhr, exception) : 'Ошибка локального API')
        }.bind(this))
    }
    ProxyProvider.prototype.clear = function () { this.network.clear() }

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

    function addStyle() {
        if (!Lampa.Template || !Lampa.Template.add) return
        Lampa.Template.add('lampa_kinozal_proto_style', '<style>' +
            '.lampa-kinozal-proto{padding:2em 3em;color:#fff}.lampa-kinozal-proto__hint{opacity:.65;margin:.5em 0 1.5em}.lampa-kinozal-proto__filter{padding:1em 1.2em;margin:.35em 0;background:rgba(255,255,255,.08);border-radius:.35em}.lampa-kinozal-proto__cards{display:flex;flex-wrap:wrap;align-items:flex-start;gap:1.1em;padding:1em 0 2em}.lampa-kinozal-proto__card-action{display:flex;align-items:center;min-height:5em;padding:.65em .8em;margin:.45em 0;background:rgba(255,255,255,.06);border-radius:.35em}.lampa-kinozal-proto__detail{padding:2em 3em;max-width:60em}.lampa-kinozal-proto__detail h2{margin-top:0}.lampa-kinozal-proto__detail p{opacity:.85;line-height:1.45}' +
            '</style>')
    }

    function SearchModal(onSubmit) {
        var input = $('<input class="input" type="text" placeholder="Например, Dune" />')
        input.val(Lampa.Storage.get(NS + 'last_query', ''))
        var html = $('<div></div>').append(input)
        setTimeout(function () { input.focus() }, 100)
        Lampa.Modal.open({
            title: 'Поиск Kinozal',
            html: html,
            size: 'small',
            buttons: [{
                name: 'Искать',
                onSelect: function () {
                    var query = String(input.val() || '').trim()
                    if (!query) return notify('Введите название', true)
                    Lampa.Modal.close()
                    onSubmit(query)
                }
            }, {
                name: 'Отмена',
                onSelect: function () { Lampa.Modal.close() }
            }],
            onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('content') }
        })
    }

    function ListScreen(object) {
        var root = $('<div class="lampa-kinozal-proto"></div>')
        var main = null
        var fallbackScroll = null
        var provider = field('mode', 'mock') === 'proxy' ? new ProxyProvider(field('proxy_url', '') || DEFAULT_PROXY_URL) : new MockProvider()
        var query = String(object.query || '')
        var category = String(object.category || field('category', 'movies'))
        var period = String(object.period || field('period', 'week'))
        var page = number(object.page) || 1
        var limit = number(field('limit', 10)) || 10

        function cardElement(item) {
            var el = $('<div class="card selector layer--visible layer--render"></div>')
            var view = $('<div class="card__view"></div>')
            var image = $('<img class="card__img" />').attr('src', item.poster || './img/img_broken.svg')
            var title = item.title + (item.year ? ' (' + item.year + ')' : '')
            view.append(image)
            el.append(view)
            el.append($('<div class="card__title"></div>').text(title))
            if (item.year) el.append($('<div class="card__age"></div>').text(item.year))
            if (item.quality) view.append($('<div class="card__quality"><div></div></div>').find('div').text(item.quality).parent())
            if (item.type === 'series') el.addClass('card--tv')
            el.on('hover:focus', function () { if (fallbackScroll) fallbackScroll.update(el, true) })
            el.on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: item.title, component: 'lampa_kinozal_detail', item: item, page: 1 })
            })
            return el
        }

        function controls(data) {
            var periodItem = TOP_PERIODS.filter(function (item) { return item.value === period })[0] || TOP_PERIODS[0]
            var categoryItem = TOP_CATEGORIES.filter(function (item) { return item.value === category })[0] || TOP_CATEGORIES[0]
            var periodButton = $('<div class="selector lampa-kinozal-proto__filter"></div>').text('Период: ' + periodItem.title)
            periodButton.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Период топа',
                    items: TOP_PERIODS,
                    onSelect: function (item) {
                        Lampa.Select.close()
                        Lampa.Activity.push({ url: '', title: 'Топ раздач', component: COMPONENT, page: 1, category: category, period: item.value })
                    },
                    onBack: function () { Lampa.Select.close(); Lampa.Controller.toggle('content') }
                })
            })
            root.append(periodButton)
            var categoryButton = $('<div class="selector lampa-kinozal-proto__filter"></div>').text('Раздел: ' + categoryItem.title)
            categoryButton.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Раздел топа',
                    items: TOP_CATEGORIES,
                    onSelect: function (item) {
                        Lampa.Select.close()
                        Lampa.Activity.push({ url: '', title: 'Топ раздач', component: COMPONENT, page: 1, category: item.value, period: period })
                    },
                    onBack: function () { Lampa.Select.close(); Lampa.Controller.toggle('content') }
                })
            })
            root.append(categoryButton)
        }

        function standardCard(item) {
            var card = $.extend({}, item)
            card.poster_path = card.poster_path || card.poster || card.img || ''
            card.img = card.img || card.poster || card.poster_path || ''
            card.source = card.source || 'kinozal'
            card.params = card.params || {}
            return card
        }

        function renderStandard(data) {
            if (!Lampa.Maker || !Lampa.Maker.make) return false
            if (main && main.destroy) main.destroy()
            var periodItem = TOP_PERIODS.filter(function (item) { return item.value === period })[0] || TOP_PERIODS[0]
            var categoryItem = TOP_CATEGORIES.filter(function (item) { return item.value === category })[0] || TOP_CATEGORIES[0]
            var line = {
                title: 'Топ раздач · ' + periodItem.title + ' · ' + categoryItem.title,
                results: data.results.map(standardCard),
                params: { items: { view: 7, mapping: 'line' } }
            }
            if (!data.results.length) line.results = [{ title: 'Ничего не найдено', params: { module: Lampa.Maker.module('Card').only('Create') } }]
            main = Lampa.Maker.make('Main', { title: 'Топ раздач', results: [] }, function (module) {
                return module.toggle(module.MASK.base, 'Callback')
            })
            main.use({
                onInstance: function (lineInstance) {
                    lineInstance.use({
                        onInstance: function (cardInstance, item) {
                            cardInstance.use({
                                onlyEnter: function () {
                                    Lampa.Activity.push({ url: '', title: item.title, component: 'lampa_kinozal_detail', item: item, page: 1 })
                                }
                            })
                        }
                    })
                }
            })
            root.append(main.render())
            main.build([line])
            return true
        }

        function renderFallback(data) {
            fallbackScroll = new Lampa.Scroll({ mask: true, over: true })
            var cards = $('<div class="lampa-kinozal-proto__cards"></div>')
            data.results.forEach(function (item) { cards.append(cardElement(item)) })
            if (!data.results.length) cards.append($('<div class="lampa-kinozal-proto__hint"></div>').text('Ничего не найдено'))
            fallbackScroll.append(cards)
            if (data.page < data.total_pages) {
                var next = $('<div class="selector lampa-kinozal-proto__card-action"></div>').text('Следующая страница')
                next.on('hover:enter', function () { load(data.page + 1) })
                fallbackScroll.append(next)
            }
            root.append(fallbackScroll.render())
        }

        function render(data) {
            root.find('.lampa-kinozal-proto__filter').remove()
            root.find('.lampa-kinozal-proto__cards, .lampa-kinozal-proto__hint').remove()
            controls(data)
            if (!renderStandard(data)) renderFallback(data)
        }

        function load(requestedPage) {
            page = requestedPage
            var activity = this.activity
            if (activity && activity.loader) activity.loader(true)
            provider.search(query, page, limit, function (data) {
                if (activity && activity.loader) activity.loader(false)
                render(data)
            }, function (message) {
                if (activity && activity.loader) activity.loader(false)
                notify(message, true)
                render({ page: page, total_pages: 1, results: [] })
            }, { category: category, period: period })
        }

        this.create = function () {
            addStyle()
            load.call(this, page)
            return root
        }
        this.render = function () { return root }
        this.destroy = function () { provider.clear(); if (main && main.destroy) main.destroy(); if (fallbackScroll && fallbackScroll.destroy) fallbackScroll.destroy(); root.remove() }
        this.start = function () {}
        this.stop = function () {}
    }

    function DetailScreen(object) {
        var item = normalize(object.item)
        var root = $('<div class="lampa-kinozal-proto__detail"></div>')
        var actions = $('<div></div>')
        var torr = new TorrAdapter(field('torr_url', ''))

        root.append($('<h2></h2>').text(item.title))
        if (item.original_title) root.append($('<p></p>').text(item.original_title))
        root.append($('<p></p>').text([item.year, item.quality, item.codec, item.size].filter(Boolean).join(' · ')))
        if (item.overview) root.append($('<p></p>').text(item.overview))
        root.append($('<p></p>').text(['Аудио: ' + (item.audio || '—'), 'Длительность: ' + (item.duration || '—'), 'Сиды: ' + item.seeds, 'Пиры: ' + item.peers].join('\n')))

        var send = $('<div class="selector lampa-kinozal-proto__card-action"></div>').text('Передать в TorrServer')
        send.on('hover:enter', function () {
            torr.send(item, function () { notify('Раздача передана') }, function (message) { notify(message, true) })
        })
        actions.append(send)

        var copy = $('<div class="selector lampa-kinozal-proto__card-action"></div>').text('Показать magnet')
        copy.on('hover:enter', function () {
            if (!item.magnet) return notify('У карточки нет magnet', true)
            Lampa.Modal.open({
                title: 'Magnet-ссылка',
                html: $('<div></div>').text(item.magnet),
                size: 'medium',
                buttons: [{ name: 'Закрыть', onSelect: function () { Lampa.Modal.close() } }],
                onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('content') }
            })
        })
        actions.append(copy)
        root.append(actions)

        this.create = function () { return root }
        this.render = function () { return root }
        this.destroy = function () { torr.clear(); root.remove() }
        this.start = function () {}
        this.stop = function () {}
    }

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
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'torr_url', type: 'input', values: '', default: '' }, field: { name: 'URL TorrServer', description: 'Добавление выполняется только по кнопке карточки' } })
        Lampa.SettingsApi.addParam({ component: NS + 'settings', param: { name: NS + 'limit', type: 'select', values: { '5': '5', '10': '10', '20': '20' }, default: '10' }, field: { name: 'Результатов на странице' } })
    }

    function addMenuItem() {
        var btn = $('<li class="menu__item selector"><div class="menu__ico"></div><div class="menu__text">Кинозал</div></li>')
        btn.on('hover:enter', function () {
        Lampa.Activity.push({ url: '', title: 'Топ раздач', component: COMPONENT, page: 1, category: 'movies', period: 'week' })
        })
        var menu = $('.menu .menu__list').eq(0)
        if (menu && menu.length) menu.append(btn)
        else if (Lampa.Menu && Lampa.Menu.addButton) {
            Lampa.Menu.addButton('', 'Кинозал', function () {
                Lampa.Activity.push({ url: '', title: 'Топ раздач', component: COMPONENT, page: 1, category: 'movies', period: 'week' })
            })
        }
    }

    function init() {
        try { addStyle() } catch (error) { logError('Не удалось добавить стили', error) }
        try { registerSettings() } catch (error) { logError('Настройки недоступны в этой версии LAMPA', error) }
        try {
            if (Lampa.Component && Lampa.Component.add) {
                if (!Lampa.Component.get || !Lampa.Component.get(COMPONENT)) Lampa.Component.add(COMPONENT, ListScreen)
                if (!Lampa.Component.get || !Lampa.Component.get('lampa_kinozal_detail')) Lampa.Component.add('lampa_kinozal_detail', DetailScreen)
            }
        } catch (error) { logError('Не удалось зарегистрировать экраны', error) }
        try { addMenuItem() } catch (error) { logError('Не удалось добавить пункт меню', error) }
    }

    if (window.appready) init()
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init() })
})()

