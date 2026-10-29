/*
 * Dependency-free local API for the LAMPA Kinozal prototype.
 *
 * By default this serves the checked-in mock dataset. Set
 * LAMPA_API_SOURCE=browser to read public Kinozal top pages through a
 * dedicated browser profile. KINOZAL_CDP_URL can attach to a separately
 * launched project Chrome window without touching the user's personal browser.
 * Authenticated torrent delivery is intentionally not implemented here yet.
 */

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
const querystring = require('querystring')

const HOST = process.env.LAMPA_API_HOST || '0.0.0.0'
const PORT = Number(process.env.LAMPA_API_PORT || 8787)
const DATA_FILE = process.env.LAMPA_API_DATA || path.join(__dirname, 'mock-results.json')
const SOURCE = process.env.LAMPA_API_SOURCE || 'mock'
const KINOZAL_BASE = (process.env.KINOZAL_BASE_URL || 'https://kinozal.me').replace(/\/$/, '')
const CHROME_PATH = process.env.KINOZAL_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BROWSER_PROFILE = process.env.KINOZAL_PROFILE_DIR || path.join(__dirname, '.kinozal-browser-profile')
const BROWSER_HEADLESS = String(process.env.KINOZAL_HEADLESS || 'false').toLowerCase() === 'true'
const BROWSER_CDP_URL = process.env.KINOZAL_CDP_URL || ''
const BROWSER_CACHE_TTL_MS = Math.max(0, Number(process.env.KINOZAL_CACHE_TTL_MS || 120000))
const BROWSER_MIN_INTERVAL_MS = Math.max(0, Number(process.env.KINOZAL_MIN_INTERVAL_MS || 3000))
const MAGNET_RE = /^magnet:\?xt=urn:btih:[a-z0-9]{6,}(?:&[^\s]*)?$/i

// Image proxy: posters from fastpic etc. are often unreachable from the TV,
// so the server downloads and caches them locally. Disable with
// KINOZAL_IMAGE_PROXY=off.
const crypto = require('crypto')
const IMG_CACHE_DIR = process.env.KINOZAL_IMG_CACHE || path.join(__dirname, '.img-cache')
const IMAGE_PROXY_ENABLED = String(process.env.KINOZAL_IMAGE_PROXY || 'on').toLowerCase() !== 'off'
const IMG_MAX_BYTES = 10 * 1024 * 1024
const imgInflight = new Map()

const TOP_CATEGORIES = Object.freeze({
    series: 3,
    series_ru: 31,
    series_foreign: 32,
    movies: 1
})

let browserContextPromise = null
let browserPagePromise = null
let browserConnection = null
let browserLastRequestAt = 0
let browserQueue = Promise.resolve()
const browserCache = new Map()

function loadItems() {
    const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return Array.isArray(payload.results) ? payload.results : []
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
}

function absoluteUrl(value) {
    try { return new URL(value, KINOZAL_BASE).toString() } catch (error) { return '' }
}

function parseTitle(title) {
    const parts = title.split(/\s*\/\s*/).map(item => item.trim()).filter(Boolean)
    const yearMatch = title.match(/\b(19\d{2}|20\d{2})(?:-(19\d{2}|20\d{2}))?\b/)
    const quality = (title.match(/(?:2160p|1080p|720p|4K|Blu-Ray|WEB-DL|WEB-DLRip|BDRip|HDTVRip|HDR|HEVC|Lossless)/i) || [])[0] || ''
    return {
        title: parts[0] || title,
        original_title: parts[1] && !/^\d{4}/.test(parts[1]) ? parts[1] : '',
        year: yearMatch ? Number(yearMatch[1]) : '',
        quality
    }
}

function parseTopPage(html) {
    const stable = html.match(/<div[^>]*class=["'][^"']*\bstable\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    if (!stable) {
        if (/cf-chl-|challenge-platform|Выполнение проверки безопасности|Just a moment/i.test(html)) {
            throw new Error('Kinozal вернул проверку Cloudflare')
        }
        throw new Error('Не найден блок топа Kinozal')
    }

    const results = []
    const seen = new Set()
    const itemRe = /<a\s+href=["'](?:https?:\/\/kinozal\.me)?\/details\.php\?id=(\d+)["'][^>]*title=["']([^"']+)["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/gi
    let match
    while ((match = itemRe.exec(stable[1]))) {
        if (seen.has(match[1])) continue
        seen.add(match[1])
        const title = decodeHtml(match[2]).replace(/\s+/g, ' ').trim()
        const parsed = parseTitle(title)
        results.push({
            id: `kinozal-${match[1]}`,
            kinozal_id: Number(match[1]),
            title: parsed.title,
            original_title: parsed.original_title,
            year: parsed.year,
            type: /сезон|серии|сериал/i.test(title) ? 'series' : 'movie',
            quality: parsed.quality,
            poster: absoluteUrl(match[3]),
            source_url: `${KINOZAL_BASE}/details.php?id=${match[1]}`,
            magnet: ''
        })
    }
    return results
}

async function fetchPublicTop(category, period) {
    const categoryCode = TOP_CATEGORIES[category] || TOP_CATEGORIES.movies
    const periodCode = period === 'month' ? 2 : 1
    const url = `${KINOZAL_BASE}/top.php?t=${categoryCode}&d=0&f=0&c=0&k=0&j=&s=0&w=${periodCode}`
    if (typeof fetch !== 'function') throw new Error('Нужен Node.js 18 или новее')
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'lampa-kinozal-local-api/0.1',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ru-RU,ru;q=0.9'
        }
    })
    if (!response.ok) throw new Error(`Kinozal HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const html = new TextDecoder('windows-1251').decode(bytes)
    const parsed = parseTopPage(html)
    if (category.indexOf('series') === 0) parsed.forEach(item => { item.type = 'series' })
    return { url, results: parsed }
}

// Стартовый свип вкладок: прошлая сессия сервера оставляет дубли.
// Кинозал — оставляем одну (первую), Pornolab — закрываем все (вкладка
// создаётся лениво при первом полном запросе карточки и сама чистит старьё).
// Возвращаем выжившую вкладку Кинозала.
function sweepStaleTabs(context) {
    const kinozalPages = context.pages().filter(p => /kinozal\.(me|tv|guru)/.test(p.url()))
    for (let i = 1; i < kinozalPages.length; i++) kinozalPages[i].close().catch(() => {})
    for (const p of context.pages()) {
        if (/pornolab\.net/.test(p.url())) p.close().catch(() => {})
    }
    return kinozalPages[0] || null
}

async function getBrowserPage() {
    if (!browserContextPromise) {
        browserContextPromise = (async () => {
            let playwright
            try {
                playwright = require('playwright-core')
            } catch (error) {
                throw new Error('Установите playwright-core: npm install playwright-core')
            }
            let context
            if (BROWSER_CDP_URL) {
                browserConnection = await playwright.chromium.connectOverCDP(BROWSER_CDP_URL)
                context = browserConnection.contexts()[0]
                if (!context) throw new Error('В отдельном Chrome не найден браузерный контекст')
                context.on('close', () => { browserContextPromise = null; browserPagePromise = null; browserConnection = null })
            } else {
                context = await playwright.chromium.launchPersistentContext(BROWSER_PROFILE, {
                    executablePath: CHROME_PATH,
                    headless: BROWSER_HEADLESS,
                    viewport: { width: 1440, height: 1000 },
                    locale: 'ru-RU',
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
                })
                context.on('close', () => { browserContextPromise = null; browserPagePromise = null })
            }
            return context
        })()
    }
    const context = await browserContextPromise
    if (!browserPagePromise) {
        browserPagePromise = (async () => {
            const pages = context.pages()
            // Вкладка Кинозала — по URL, а не pages[0]: в pages могут быть
            // служебные страницы вроде chrome://omnibox-popup
            return sweepStaleTabs(context) || pages[0] || context.newPage()
        })()
    }
    return browserPagePromise
}

async function passCloudflare(page) {
    // Детект: заголовок «Один момент…» или iframe Turnstile
    async function challenged() {
        return page.evaluate(() =>
            /Один момент|Just a moment/i.test(document.title) ||
            !!document.querySelector('iframe[src*="challenges.cloudflare.com"]')
        ).catch(() => true)
    }

    if (!await challenged()) return true

    // Пытаемся кликнуть галочку Turnstile самостоятельно (не гарантированно:
    // Turnstile сопротивляется автоматизации). До 4 попыток с паузой.
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const frame = page.frames().find(f => /challenges\.cloudflare\.com/.test(f.url()))
            if (frame) {
                const box = await frame.locator('input[type="checkbox"], .ctp-checkbox-label, label').first().boundingBox().catch(() => null)
                if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
            }
        } catch (error) { /* попробуем ещё раз после паузы */ }
        await page.waitForTimeout(3000)
        if (!await challenged()) return true
    }

    return false
}

async function loadBrowserTop(category, period) {
    const categoryCode = TOP_CATEGORIES[category] || TOP_CATEGORIES.movies
    const periodCode = period === 'month' ? 2 : 1
    const url = `${KINOZAL_BASE}/top.php?t=${categoryCode}&d=0&f=0&c=0&k=0&j=&s=0&w=${periodCode}`
    const page = await getBrowserPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

    if (!await passCloudflare(page)) {
        throw new Error('Кинозал показывает проверку Cloudflare — открой окно проекта Chrome (свернуто в панели задач) и кликни галочку вручную')
    }

    await page.waitForSelector('.stable a[href*="/details.php?id="]', { timeout: 60000 })
    const results = await page.evaluate((base) => {
        function absolute(value) {
            try { return new URL(value, base).toString() } catch (error) { return '' }
        }
        function parseTitle(title) {
            const parts = title.split(/\s*\/\s*/).map(item => item.trim()).filter(Boolean)
            const year = title.match(/\b(19\d{2}|20\d{2})\b/)
            const quality = (title.match(/(?:2160p|1080p|720p|4K|Blu-Ray|WEB-DL|WEB-DLRip|BDRip|HDTVRip|HDR|HEVC|Lossless)/i) || [])[0] || ''
            return {
                title: parts[0] || title,
                original_title: parts[1] && !/^\d{4}/.test(parts[1]) ? parts[1] : '',
                year: year ? Number(year[1]) : '',
                quality
            }
        }
        const seen = new Set()
        return Array.from(document.querySelectorAll('.stable a[href*="/details.php?id="]')).map(anchor => {
            const match = (anchor.getAttribute('href') || '').match(/[?&]id=(\d+)/)
            const image = anchor.querySelector('img')
            const rawTitle = (anchor.getAttribute('title') || anchor.textContent || '').replace(/\s+/g, ' ').trim()
            if (!match || seen.has(match[1])) return null
            seen.add(match[1])
            const parsed = parseTitle(rawTitle)
            return {
                id: `kinozal-${match[1]}`,
                kinozal_id: Number(match[1]),
                title: parsed.title,
                original_title: parsed.original_title,
                year: parsed.year,
                type: /сезон|серии|сериал/i.test(rawTitle) ? 'series' : 'movie',
                quality: parsed.quality,
                poster: absolute(image && image.getAttribute('src')), 
                source_url: absolute(anchor.getAttribute('href')),
                magnet: ''
            }
        }).filter(Boolean)
    }, KINOZAL_BASE)

    // В сериальных разделах Кинозала тип определяем по разделу, а не по названию.
    if (category.indexOf('series') === 0) results.forEach(item => { item.type = 'series' })

    return { url, results }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchBrowserTop(category, period) {
    const key = `${category}:${period}`
    const cached = browserCache.get(key)
    if (cached && Date.now() - cached.at < BROWSER_CACHE_TTL_MS) return cached.payload

    const run = browserQueue.then(async () => {
        const fresh = browserCache.get(key)
        if (fresh && Date.now() - fresh.at < BROWSER_CACHE_TTL_MS) return fresh.payload
        const waitFor = BROWSER_MIN_INTERVAL_MS - (Date.now() - browserLastRequestAt)
        if (waitFor > 0) await wait(waitFor)
        const payload = await loadBrowserTop(category, period)
        browserLastRequestAt = Date.now()
        browserCache.set(key, { at: browserLastRequestAt, payload })
        return payload
    })
    browserQueue = run.catch(() => {})
    return run
}

function sendJson(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Length': body.length
    })
    res.end(body)
}

/*
 * NM (NNM-Club) — витрины новинок через portal.php?c=<id>, анонимно,
 * без браузера. Постеры идут через общий /img прокси.
 * Раздел = одна или несколько категорий портала (карточки сливаются).
 */
const NM_BASE = (process.env.NNM_BASE_URL || 'https://nnmclub.to').replace(/\/$/, '')
const NM_SECTIONS = Object.freeze({
    movies_new: [10],
    movies_foreign: [6, 11],
    series_ru: [4],
    series_foreign: [3],
    doc: [22, 23],
    theater: [21]
})
const NM_CACHE_TTL_MS = Math.max(0, Number(process.env.NNM_CACHE_TTL_MS || 300000))
const nmCache = new Map()

function nmDecodeHtml(s) {
    return String(s || '')
        .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(+c))
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

function nmParsePortal(html) {
    const cards = []
    const seen = new Set()
    for (const chunk of html.split(/<table[^>]*class="pline"/g).slice(1)) {
        if (!/portalImg|portbody/.test(chunk)) continue
        const head = chunk.match(/viewtopic\.php\?t=(\d+)"[^>]*title="([^"]{5,200})"/)
        if (!head) continue
        const id = +head[1]
        if (seen.has(id)) continue
        seen.add(id)
        cards.push({
            id,
            title: nmDecodeHtml(head[2]).replace(/\s+/g, ' ').trim(),
            poster: ((chunk.match(/<var\s+class="portalImg"[^>]*title="([^"]+)"/i) || [])[1] || '').replace(/&amp;/g, '&'),
            magnet: (chunk.match(/magnet:\?xt=urn:btih:[A-Za-z0-9]{32,}/i) || [])[0] || '',
            date: ((chunk.match(/\|\s*(\d{1,2}\s+[А-Яа-яЁё]{3}\s+\d{4}[^<|]*)/) || [])[1] || '').trim(),
            desc: nmDecodeHtml(((chunk.match(/<span class="portbody">([\s\S]{0,4000}?)<\/span>/) || [])[1] || ''))
                .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700)
        })
    }
    return cards
}

// Ключ дедупликации: название без качества/перевода/сезонов + год
function nmBaseKey(title) {
    let s = String(title).split('[')[0]
    const year = (s.match(/\b(19\d{2}|20\d{2})\b/) || [])[0] || ''
    s = s.split('(')[0]
    s = s.toLowerCase().replace(/ё/g, 'е').replace(/[^\wа-яa-z ]+/gi, ' ').replace(/\s+/g, ' ').trim()
    return s + '|' + year
}

function nmQuality(title) {
    // Пользователь смотрит максимум 1080p: 4K-дубли отбрасываем в конец
    if (/2160p|UHD|4K/i.test(title)) return 0
    if (/1080p|FHD/i.test(title)) return 4
    if (/720p|HD\b/i.test(title)) return 3
    return 2
}

function nmIsSeries(title) {
    return /сезон|серии\s+из|сериал/i.test(title)
}

async function nmLoadSection(sectionId, days) {
    const results = []
    const seenIds = new Set()
    const byKey = new Map()
    for (const categoryId of days) {
        const url = `${NM_BASE}/forum/portal.php?c=${categoryId}`
        let html
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131', 'Accept-Language': 'ru-RU,ru;q=0.9' },
                signal: AbortSignal.timeout(25000)
            })
            if (!response.ok) continue
            html = new TextDecoder('windows-1251').decode(Buffer.from(await response.arrayBuffer()))
        } catch (error) { continue }
        for (const card of nmParsePortal(html)) {
            if (seenIds.has(card.id)) continue
            seenIds.add(card.id)
            if (card.title.length < 8) continue
            const key = nmBaseKey(card.title)
            const item = {
                id: 'nm-' + card.id,
                nm_id: card.id,
                title: card.title,
                year: ((card.title.match(/\b(19\d{2}|20\d{2})\b/) || [])[0]) || '',
                type: nmIsSeries(card.title) ? 'series' : 'movie',
                poster: card.poster,
                overview: card.desc,
                magnet: card.magnet,
                source_url: `${NM_BASE}/forum/viewtopic.php?t=${card.id}`,
                published_at: card.date,
                _key: key,
                _q: nmQuality(card.title)
            }
            const prev = byKey.get(key)
            if (prev) {
                if (item._q > prev._q) {
                    results.splice(results.indexOf(prev), 1, item)
                    byKey.set(key, item)
                }
            } else {
                results.push(item)
                byKey.set(key, item)
            }
        }
    }
    return results
}

async function nmSection(section, categoryIds) {
    const key = section
    const cached = nmCache.get(key)
    if (cached && Date.now() - cached.at < NM_CACHE_TTL_MS) return cached.payload
    const payload = await nmLoadSection(section, categoryIds)
    nmCache.set(key, { at: Date.now(), payload })
    return payload
}

/*
 * RT (RuTracker) — разделы через viewforum, чтение браузером (сессия с логином
 * в профиле .kinozal-manual-profile). Карточки собраны из строк списка
 * (title/size/seeds/date), magnet/poster/description — лениво через /rt/v1/card.
 */
const RT_BASE = (process.env.RT_BASE_URL || 'https://rutracker.org').replace(/\/$/, '')
const RT_SECTIONS = Object.freeze({
    movies_new: [252],
    movies_ru: [22],
    series_foreign: [1803],
    series_ru: [81],
    theater: [511]
})
const RT_LIST_TTL_MS = Math.max(0, Number(process.env.RT_LIST_TTL_MS || 180000))
const RT_CARD_TTL_MS = Math.max(0, Number(process.env.RT_CARD_TTL_MS || 1800000))
const rtListCache = new Map()
const rtCardCache = new Map()

function rtDecodeHtml(s) {
    return String(s || '')
        .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(+c))
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

/*
 * RT-страницы: отдельные вкладки проекта Chrome — списки разделов не ждут
 * очередь карточек, карточки качаются двумя параллельными потоками.
 */
let rtPageList = null
const rtPagesCard = []
let rtCardPageIdx = 0
const rtPageChains = new Map()
let rtPagesReady = null

async function rtEnsurePages() {
    if (rtPagesReady) return rtPagesReady
    rtPagesReady = (async () => {
        const page = await getBrowserPage()
        const ctx = page.context()
        // Прошлые запуски сервера оставляли свои вкладки Рутрекера — подчищаем
        for (const p of ctx.pages()) {
            if (/rutracker\.org/.test(p.url())) await p.close().catch(() => {})
        }
        rtPageList = await ctx.newPage()
        // 3 воркера: на 60 карточек два не успевали — хвост падал по таймауту
        for (let i = 0; i < 3; i++) rtPagesCard.push(await ctx.newPage())
    })().catch(e => { rtPagesReady = null; throw e })
    return rtPagesReady
}

async function rtNavigate(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(700)
    const html = await page.content()
    if (/Just a moment/i.test(html)) throw new Error('RuTracker просит проверку Cloudflare — открой окно проекта Chrome и пройди её вручную')
    return html
}

let rtOriginWarm = false

async function rtWarmOrigin() {
    await rtEnsurePages()
    if (rtOriginWarm) return
    // Все страницы должны стоять на origin rutracker.org — тогда внутренний
    // fetch ходит с куками и отпечатком браузера и проходит Cloudflare
    await rtNavigate(rtPageList, RT_BASE + '/forum/index.php')
    for (const page of rtPagesCard) await rtNavigate(page, RT_BASE + '/forum/index.php')
    rtOriginWarm = true
}

async function rtFetchHtml(url, isCard) {
    await rtWarmOrigin()
    const page = isCard ? rtPagesCard[rtCardPageIdx++ % rtPagesCard.length] : rtPageList
    const prev = rtPageChains.get(page) || Promise.resolve()
    const run = prev.then(async () => {
        // Быстрый путь: fetch внутри страницы (куки + отпечаток браузера).
        // Рутрекер отдаёт windows-1251 — декодируем байты в браузере,
        // иначе русский текст превращается в кракозябры.
        try {
            const html = await page.evaluate(async (u) => {
                const r = await fetch(u, { credentials: 'include' })
                const bytes = await r.arrayBuffer()
                return new TextDecoder('windows-1251').decode(bytes)
            }, url)
            if (html && !/Just a moment/i.test(html)) return html
        } catch (e) { /* упадём в медленную навигацию */ }
        // Резерв: полноценная навигация вкладки (page.content() декодирует сам)
        return rtNavigate(page, url)
    })
    rtPageChains.set(page, run.catch(() => ''))
    return run
}

function rtParseForum(html) {
    const cards = []
    const chunks = html.match(/<tr[^>]*data-topic_id="\d+"[\s\S]*?<\/tr>/g) || []
    for (const chunk of chunks) {
        if (!chunk.includes('seedmed')) continue // правила/объявления без торрента
        const idMatch = chunk.match(/data-topic_id="(\d+)"/)
        const titleMatch = chunk.match(/<a[^>]*class="[^"]*\btorTopic\b[^"]*"[^>]*>([\s\S]{5,300}?)<\/a>/)
        if (!idMatch || !titleMatch) continue
        const id = +idMatch[1]
        const title = rtDecodeHtml(titleMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/^[·\s*]+/, '').trim()
        const seeds = (chunk.match(/class="seedmed"[^>]*>(?:<b>)?(\d+)/) || [])[1] || ''
        const leech = (chunk.match(/class="leechmed"[^>]*>(?:<b>)?(\d+)/) || [])[1] || ''
        const size = rtDecodeHtml((chunk.match(/href="dl\.php\?t=\d+"[^>]*>([\d.,]+(?:&nbsp;|\s)?[А-Яа-яЁёA-Za-z]{2})</) || [])[1] || '').replace(/\s+/g, ' ').trim()
        const date = (chunk.match(/(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2})/) || [])[1] || ''
        cards.push({
            id: 'rt-' + id,
            rt_id: id,
            title,
            size: size.trim(),
            seeds: Number(seeds),
            leech: Number(leech),
            published_at: date,
            source_url: `${RT_BASE}/forum/viewtopic.php?t=${id}`,
            magnet: ''
        })
    }
    return cards
}

function rtParseTopic(html) {
    const magnet = (html.match(/magnet:\?xt=urn:btih:[A-F0-9a-f]{32,}/) || [])[0] || ''
    // Постер: первая картинка первого поста. У Рутрекера она может быть
    // и в <var class="postImg" title="URL">, и обычным <img class="postImg">.
    const firstPost = (html.match(/class="post_body"[^>]*>([\s\S]{0,6000}?)<\/div>/) || [])[1] || html
    let poster = rtDecodeHtml((firstPost.match(/class="postImg[^"]*"[^>]*title="([^"]+)"/i) || [])[1] || '')
    if (!poster) poster = rtDecodeHtml((firstPost.match(/<img[^>]+class="[^"]*postImg[^"]*"[^>]*src="([^"]+)"/i) || [])[1] || '')
    if (!poster) poster = rtDecodeHtml((firstPost.match(/<img[^>]+src="(https?:\/\/[^"]+(?:fastpic|imageban|postimg|pixhost|imgur|rutracker)[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i) || [])[1] || '')
    const descChunk = (html.match(/class="post_body"[^>]*>([\s\S]{0,6000}?)<\/div>/) || [])[1] || ''
    const desc = rtDecodeHtml(descChunk.replace(/<var[\s\S]*?<\/var>/g, ' ').replace(/<img[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    return { magnet, poster: poster.trim(), overview: desc.slice(0, 700) }
}

async function rtList(section) {
    const cacheKey = section
    const cached = rtListCache.get(cacheKey)
    if (cached && Date.now() - cached.at < RT_LIST_TTL_MS) return cached.payload

    const forumIds = RT_SECTIONS[section]
    const merged = []
    const seenIds = new Set()
    const byKey = new Map()
    for (const forumId of forumIds) {
        const html = await rtFetchHtml(`${RT_BASE}/forum/viewforum.php?f=${forumId}`)
        for (const card of rtParseForum(html)) {
            if (seenIds.has(card.id)) continue
            seenIds.add(card.id)
            const key = nmBaseKey(card.title)
            const prev = byKey.get(key)
            if (prev) {
                if (nmQuality(card.title) > nmQuality(prev.title)) {
                    merged.splice(merged.indexOf(prev), 1, card)
                    byKey.set(key, card)
                }
            } else {
                merged.push(card)
                byKey.set(key, card)
            }
        }
    }
    rtListCache.set(cacheKey, { at: Date.now(), payload: merged })
    return merged
}

async function rtCard(topicId) {
    const cached = rtCardCache.get(topicId)
    if (cached && Date.now() - cached.at < RT_CARD_TTL_MS) return cached.payload

    const html = await rtFetchHtml(`${RT_BASE}/forum/viewtopic.php?t=${topicId}`, true)
    if (/Just a moment/i.test(html)) throw new Error('RuTracker показал проверку Cloudflare — открой окно проекта Chrome и пройди её вручную')
    const parsed = rtParseTopic(html)
    const payload = Object.assign({ rt_id: topicId }, parsed)
    rtCardCache.set(topicId, { at: Date.now(), payload })
    return payload
}

/*
 * PL (Pornolab.net) — тот же движок TorrentPier, что у Рутрекера, windows-1251.
 * Списки (чарты популярных релизов f=489 и ситрипы) читаются анонимно обычным
 * fetch — браузер не нужен. Карточки и магниты — через одну залогиненную вкладку
 * проекта Chrome (магнит на странице не показывается, считаем infohash из .torrent).
 */
const PL_BASE = (process.env.PL_BASE_URL || 'https://pornolab.net/forum').replace(/\/$/, '')
const PL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36'
const PL_LIST_TTL_MS = Math.max(0, Number(process.env.PL_LIST_TTL_MS || 300000))
const PL_CARD_TTL_MS = Math.max(0, Number(process.env.PL_CARD_TTL_MS || 1800000))
const PL_LIST_LIMIT = 50
const plListCache = new Map()
const plCardCache = new Map()

function plDecodeHtml(s) {
    return String(s || '')
        .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(+c))
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

async function plFetchHtml(url) {
    const response = await fetch(url, {
        headers: { 'User-Agent': PL_UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
        signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) throw new Error(`Pornolab HTTP ${response.status}`)
    return new TextDecoder('windows-1251').decode(Buffer.from(await response.arrayBuffer()))
}

// Релизы-«картинки» (фотосеты) не воспроизводятся через TorrServer — в списки не берём.
function plIsPhotoSet(title) {
    return /(\d+\s*(?:фото|pics|images)|фотосет|\bсэт[а-я]*\b.*фото|только фото)/i.test(title)
}

function plRowId(chunk) {
    return (chunk.match(/<tr id="tr-(\d+)"/) || [])[1] || ''
}

function plRowTitle(chunk) {
    const raw = (chunk.match(/class="topictitle[^"]*"[^>]*>([\s\S]{5,400}?)<\/a>/) || [])[1] || ''
    return plDecodeHtml(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function plRowSize(chunk) {
    return plDecodeHtml((chunk.match(/([0-9.,]+(?:&nbsp;|\s)+(?:GB|MB|TB|KB))/) || [])[1] || '').replace(/\s+/g, ' ').trim()
}

function plCardItem(topicId, title, size) {
    return {
        id: 'pl-' + topicId,
        pl_id: +topicId,
        title,
        size: size || '',
        seeds: 0,
        published_at: '',
        source_url: `${PL_BASE}/viewtopic.php?t=${topicId}`,
        magnet: '',
        type: 'movie'
    }
}

function plParseForum(html) {
    const cards = []
    for (const chunk of (html.match(/<tr id="tr-\d+"[\s\S]*?<\/tr>/g) || [])) {
        const id = plRowId(chunk)
        const title = plRowTitle(chunk)
        if (!id || !title || /правила|правил\b/i.test(title)) continue
        if (plIsPhotoSet(title)) continue
        cards.push(plCardItem(id, title, plRowSize(chunk)))
        if (cards.length >= PL_LIST_LIMIT) break
    }
    return cards
}

// В f=489 чарты лежат темами: недельные «12.10.2026-1», месячные «Сентябрь / September 2026».
function plFindChartTopic(html, kind) {
    for (const chunk of (html.match(/<tr id="tr-\d+"[\s\S]*?<\/tr>/g) || [])) {
        const id = plRowId(chunk)
        const title = plRowTitle(chunk)
        if (!id || !title) continue
        if (kind === 'week' && /^\d{2}\.\d{2}\.\d{4}-\d/.test(title)) return id
        if (kind === 'month' && /^[А-Яа-яЁё]+ \/ [A-Za-z]+ \d{4}$/.test(title)) return id
    }
    return 0
}

// Первый пост темы-чарта: группы-разделы (ссылки на viewforum) + пункты
// «позиция <a viewtopic>название</a> автор (размер)». Режем по заголовкам групп.
function plParseChart(html) {
    const start = html.indexOf('post_body" id="p-')
    const end = start >= 0 ? html.indexOf('post_body-->', start) : -1
    const body = start >= 0 && end > start ? html.slice(start, end) : html

    const items = []
    const seen = new Set()
    const headerRe = /viewforum\.php\?f=\d+" class="postLink">([^<]{2,120})</g
    let header = ''
    let positions = []
    let m
    while ((m = headerRe.exec(body)) !== null) positions.push({ at: m.index, name: plDecodeHtml(m[1]).trim() })
    positions.push({ at: body.length, name: '' })

    for (let i = 0; i < positions.length - 1; i++) {
        const segment = body.slice(positions[i].at, positions[i + 1].at)
        const itemRe = /viewtopic\.php\?t=(\d+)" class="postLink">([\s\S]{5,500}?)<\/a>([\s\S]{0,300}?post-u">\(([^)]{2,20})\))?/g
        let im
        while ((im = itemRe.exec(segment)) !== null) {
            const id = im[1]
            if (seen.has(id)) continue
            const title = plDecodeHtml(im[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
            if (!title || plIsPhotoSet(title)) continue
            seen.add(id)
            items.push(plCardItem(id, title, plDecodeHtml(im[4] || '').trim()))
        }
    }
    return items
}

async function plList(section) {
    const cached = plListCache.get(section)
    if (cached && Date.now() - cached.at < PL_LIST_TTL_MS) return cached.payload

    let items = []
    if (section === 'week' || section === 'month') {
        const forumHtml = await plFetchHtml(`${PL_BASE}/viewforum.php?f=489`)
        const topicId = plFindChartTopic(forumHtml, section)
        if (!topicId) throw new Error('Не нашёл тему чарта (' + (section === 'week' ? 'неделя' : 'месяц') + ') на Pornolab')
        items = plParseChart(await plFetchHtml(`${PL_BASE}/viewtopic.php?t=${topicId}`))
    } else {
        const forumId = section === 'siterips' ? 1876 : 1877
        items = plParseForum(await plFetchHtml(`${PL_BASE}/viewforum.php?f=${forumId}`))
    }
    if (!items.length) throw new Error('Pornolab вернул пустой список')
    plListCache.set(section, { at: Date.now(), payload: items })
    return items
}

/*
 * bencode: минимальный кодек, чтобы посчитать infohash скачанного .torrent
 * (sha1 от канонически перекодированного словаря info).
 */
function plBencodeDecode(buf, pos = 0) {
    const c = buf[pos]
    if (c === 0x64) { // d
        pos++
        const dict = {}
        while (buf[pos] !== 0x65) {
            const [k, p1] = plBencodeDecode(buf, pos)
            const [v, p2] = plBencodeDecode(buf, p1)
            dict[k] = v
            pos = p2
        }
        return [dict, pos + 1]
    }
    if (c === 0x6c) { // l
        pos++
        const arr = []
        while (buf[pos] !== 0x65) {
            const [v, p] = plBencodeDecode(buf, pos)
            arr.push(v)
            pos = p
        }
        return [arr, pos + 1]
    }
    if (c === 0x69) { // i
        const e = buf.indexOf(0x65, pos)
        return [BigInt(buf.slice(pos + 1, e).toString()), e + 1]
    }
    const colon = buf.indexOf(0x3a, pos)
    const len = +buf.slice(pos, colon).toString()
    return [buf.slice(colon + 1, colon + 1 + len), colon + 1 + len]
}

function plBencodeEncode(value, out = []) {
    if (Buffer.isBuffer(value)) { out.push(Buffer.byteLength(value) + ':', value); return out }
    if (typeof value === 'bigint') { out.push('i' + value + 'e'); return out }
    if (Array.isArray(value)) { out.push('l'); value.forEach(v => plBencodeEncode(v, out)); out.push('e'); return out }
    out.push('d')
    for (const key of Object.keys(value).sort()) {
        plBencodeEncode(Buffer.from(key), out)
        plBencodeEncode(value[key], out)
    }
    out.push('e')
    return out
}

function plTorrentMagnet(buf) {
    const [root] = plBencodeDecode(buf)
    const info = root && root.info
    if (!info) return ''
    const encoded = Buffer.concat(plBencodeEncode(info).map(x => Buffer.isBuffer(x) ? x : Buffer.from(x)))
    const hash = crypto.createHash('sha1').update(encoded).digest('hex')
    let magnet = `magnet:?xt=urn:btih:${hash}`
    const name = info['name.utf-8'] || info.name
    if (name) magnet += `&dn=${encodeURIComponent(name.toString())}`
    const announce = root['announce.utf-8'] || root.announce
    if (announce) magnet += `&tr=${encodeURIComponent(announce.toString())}`
    return magnet
}

/*
 * Лёгкая карточка: постер и описание читаются анонимно (темы видны гостю),
 * без браузера. Ограничиваем параллелизм, чтобы не долбить Pornolab.
 */
const PL_FETCH_CONCURRENCY = 6
let plFetchActive = 0
const plFetchQueue = []

async function plWithSlot(run) {
    if (plFetchActive >= PL_FETCH_CONCURRENCY) {
        await new Promise(resolve => plFetchQueue.push(resolve))
    }
    plFetchActive++
    try {
        return await run()
    } finally {
        plFetchActive--
        const next = plFetchQueue.shift()
        if (next) next()
    }
}

// Первый пост темы: от маркера post_body до <!--/post_body--> (ленивый регэксп
// обрезался на внутреннем <div class="mc-note"> и терял постер/описание).
// Постер у гостя лежит в <var class="postImg" title="URL">.
function plParseTopicParts(html) {
    const pbStart = html.indexOf('post_body" id="p-')
    const pbEnd = pbStart >= 0 ? html.indexOf('post_body-->', pbStart) : -1
    const firstPost = pbStart >= 0 && pbEnd > pbStart ? html.slice(pbStart, pbEnd) : html
    let poster = plDecodeHtml((firstPost.match(/class="postImg[^"]*"[^>]*title="([^"]+)"/i) || [])[1] || '')
    if (!poster) poster = plDecodeHtml((firstPost.match(/<img[^>]+class="[^"]*postImg[^"]*"[^>]*src="([^"]+)"/i) || [])[1] || '')
    const desc = plDecodeHtml(firstPost.replace(/^[^>]*>/, '').replace(/<var[\s\S]*?<\/var>/g, ' ').replace(/<img[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    return { poster: poster.trim(), overview: desc.slice(0, 700) }
}

async function plCardLight(topicId) {
    const key = 'l' + topicId
    const cached = plCardCache.get(key)
    if (cached && Date.now() - cached.at < PL_CARD_TTL_MS) return cached.payload
    const payload = await plWithSlot(async () => {
        const html = await plFetchHtml(`${PL_BASE}/viewtopic.php?t=${topicId}`)
        return plParseTopicParts(html)
    })
    plCardCache.set(key, { at: Date.now(), payload })
    return payload
}

/*
 * Карточки PL: одна залогиненная вкладка проекта Chrome на origin pornolab.net.
 * Вкладку не закрываем — она одна и переиспользуется (без утечки вкладок).
 */
let plPageCard = null
let plPagesReady = null
let plPageChain = Promise.resolve()
// Pornolab открывает рекламные попандеры из нашей вкладки — прибираем сразу,
// иначе в проектном Chrome накопятся dynspt/promo-вкладки.
const PL_AD_URL_RE = /promo\.php|dynspt\.com|go\.pornolab|\/click/

async function plEnsurePage() {
    if (plPagesReady) return plPagesReady
    plPagesReady = (async () => {
        const page = await getBrowserPage()
        // Прошлые запуски сервера оставляли свои вкладки Pornolab — подчищаем
        for (const p of page.context().pages()) {
            if (/pornolab\.net/.test(p.url())) await p.close().catch(() => {})
        }
        if (!page.context().__plAdGuard) {
            page.context().__plAdGuard = true
            page.context().on('page', popped => {
                popped.url().match(PL_AD_URL_RE) ? popped.close().catch(() => {}) : null
            })
        }
        plPageCard = await page.context().newPage()
        await plPageCard.goto(PL_BASE + '/index.php', { waitUntil: 'domcontentloaded', timeout: 45000 })
        await plPageCard.waitForTimeout(700)
        const loggedIn = await plPageCard.evaluate(() => (typeof LOGGED_IN !== 'undefined') ? LOGGED_IN : 0).catch(() => 0)
        if (!loggedIn) throw new Error('Pornolab: нет авторизации в проектном Chrome — залогиньтесь в его окне')
    })().catch(e => { plPagesReady = null; throw e })
    return plPagesReady
}

async function plCard(topicId) {
    const cached = plCardCache.get(topicId)
    if (cached && Date.now() - cached.at < PL_CARD_TTL_MS) return cached.payload

    await plEnsurePage()
    const page = plPageCard
    const run = plPageChain.then(async () => {
        const data = await page.evaluate(async (t) => {
            const r1 = await fetch(`/forum/viewtopic.php?t=${t}`, { credentials: 'include' })
            const html = new TextDecoder('windows-1251').decode(await r1.arrayBuffer())
            let torrentB64 = ''
            try {
                document.cookie = `bb_dl=${t}; path=/forum/`
                const r2 = await fetch(`/forum/dl.php?t=${t}`, { credentials: 'include' })
                if (r2.ok) {
                    const bytes = new Uint8Array(await r2.arrayBuffer())
                    let bin = ''
                    bytes.forEach(b => { bin += String.fromCharCode(b) })
                    torrentB64 = btoa(bin)
                }
            } catch (e) { /* магнит посчитать не выйдет — вернём пустой */ }
            return { html, torrentB64 }
        }, topicId)

        const html = data.html
        const payload = {
            pl_id: +topicId,
            magnet: data.torrentB64 ? plTorrentMagnet(Buffer.from(data.torrentB64, 'base64')) : '',
            ...plParseTopicParts(html)
        }
        plCardCache.set(topicId, { at: Date.now(), payload })
        return payload
    })
    plPageChain = run.catch(() => '')
    return run
}

function pageOf(items, page, limit) {
    const totalPages = Math.max(1, Math.ceil(items.length / limit))
    const start = (page - 1) * limit
    return { page, total_pages: totalPages, results: items.slice(start, start + limit) }
}

function proxyImageUrl(host, value) {
    if (!IMAGE_PROXY_ENABLED || !host) return value
    try {
        const parsed = new URL(value)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
        return `http://${host}/img?url=${encodeURIComponent(parsed.toString())}`
    } catch (error) {
        return value
    }
}

function proxyPosters(host, payload) {
    // Не мутируем элементы: payload может быть из кэша, повторное
    // проксирование дало бы двойную обёртку /img?url=.
    payload.results = payload.results.map(item => {
        const copy = Object.assign({}, item)
        if (copy.poster) copy.poster = proxyImageUrl(host, copy.poster)
        return copy
    })
    return payload
}

function imageFilePath(urlKey) {
    return path.join(IMG_CACHE_DIR, crypto.createHash('sha1').update(urlKey).digest('hex'))
}

async function downloadImage(target) {
    const response = await fetch(target.toString(), {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) throw new Error(`Image HTTP ${response.status}`)
    const contentType = String(response.headers.get('content-type') || 'image/jpeg')
    if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > IMG_MAX_BYTES) throw new Error('Image too large')
    return { bytes, contentType }
}

async function handleImage(res, rawUrl) {
    let target
    try {
        target = new URL(String(rawUrl || ''))
    } catch (error) {
        return sendJson(res, 400, { ok: false, message: 'Некорректный url' })
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return sendJson(res, 400, { ok: false, message: 'Некорректный протокол' })
    }

    const file = imageFilePath(target.toString())
    const metaFile = `${file}.type`

    if (fs.existsSync(file) && fs.existsSync(metaFile)) {
        res.writeHead(200, {
            'Content-Type': fs.readFileSync(metaFile, 'utf8'),
            'Cache-Control': 'public, max-age=604800',
            'Access-Control-Allow-Origin': '*'
        })
        return res.end(fs.readFileSync(file))
    }

    let pending = imgInflight.get(target.toString())
    if (!pending) {
        pending = (async () => {
            const { bytes, contentType } = await downloadImage(target)
            fs.mkdirSync(IMG_CACHE_DIR, { recursive: true })
            fs.writeFileSync(file, bytes)
            fs.writeFileSync(metaFile, contentType)
            return { bytes, contentType }
        })().finally(() => imgInflight.delete(target.toString()))
        imgInflight.set(target.toString(), pending)
    }

    try {
        const { bytes, contentType } = await pending
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=604800',
            'Access-Control-Allow-Origin': '*'
        })
        return res.end(bytes)
    } catch (error) {
        return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось скачать изображение' })
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = ''
        req.setEncoding('utf8')
        req.on('data', chunk => { raw += chunk })
        req.on('end', () => {
            if (!raw) return resolve({})
            try {
                if ((req.headers['content-type'] || '').includes('application/json')) return resolve(JSON.parse(raw))
                resolve(querystring.parse(raw))
            } catch (error) {
                reject(error)
            }
        })
        req.on('error', reject)
    })
}

const items = loadItems()

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendJson(res, 204, {})

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, {
            ok: true,
            service: 'lampa-kinozal-dev',
            mode: SOURCE,
            browser_profile: SOURCE === 'browser' ? (BROWSER_CDP_URL ? 'separate-project-chrome' : BROWSER_PROFILE) : ''
        })
    }

    if (req.method === 'GET' && url.pathname === '/v1/search') {
        try {
            const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1)
            const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10) || 10))
            if (SOURCE === 'browser') {
                const category = String(url.searchParams.get('category') || 'movies')
                const period = String(url.searchParams.get('period') || 'week')
                const payload = await fetchBrowserTop(category, period)
                return sendJson(res, 200, proxyPosters(req.headers.host, pageOf(payload.results, page, limit)))
            }
            if (SOURCE === 'public') {
                const category = String(url.searchParams.get('category') || 'movies')
                const period = String(url.searchParams.get('period') || 'week')
                const payload = await fetchPublicTop(category, period)
                return sendJson(res, 200, proxyPosters(req.headers.host, pageOf(payload.results, page, limit)))
            }
            const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase()
            const matches = query
                ? items.filter(item => `${item.title || ''} ${item.original_title || ''}`.toLocaleLowerCase().includes(query))
                : items
            return sendJson(res, 200, pageOf(matches, page, limit))
        } catch (error) {
            return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось получить топ Kinozal' })
        }
    }

    if (req.method === 'POST' && url.pathname === '/v1/torrents') {
        try {
            const body = await readBody(req)
            if (!MAGNET_RE.test(String(body.magnet || ''))) {
                return sendJson(res, 400, { ok: false, message: 'Некорректная magnet-ссылка' })
            }
            return sendJson(res, 200, {
                ok: true,
                dry_run: true,
                message: 'Раздача принята dev API; отправка в TorrServer пока отключена'
            })
        } catch (error) {
            return sendJson(res, 400, { ok: false, message: 'Некорректное тело запроса' })
        }
    }

    if (req.method === 'GET' && url.pathname === '/rt/v1/list') {
        const section = String(url.searchParams.get('section') || 'movies_new')
        if (!RT_SECTIONS[section]) return sendJson(res, 400, { ok: false, message: 'Неизвестный раздел RT' })
        const limit = Math.min(80, Math.max(10, Number(url.searchParams.get('limit') || 60) || 60))
        const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1)
        try {
            const items = await rtList(section)
            return sendJson(res, 200, proxyPosters(req.headers.host, pageOf(items, page, limit)))
        } catch (error) {
            return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось получить раздел RuTracker' })
        }
    }

    if (req.method === 'GET' && url.pathname === '/rt/v1/card') {
        const topicId = String(url.searchParams.get('t') || '').replace(/\D/g, '')
        if (!topicId) return sendJson(res, 400, { ok: false, message: 'Нет id темы' })
        try {
            const card = await rtCard(topicId)
            card.poster = card.poster ? proxyImageUrl(req.headers.host, card.poster) : ''
            return sendJson(res, 200, card)
        } catch (error) {
            return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось получить тему RuTracker' })
        }
    }

    if (req.method === 'GET' && url.pathname === '/pl/v1/list') {
        const section = String(url.searchParams.get('section') || 'week')
        if (!['week', 'month', 'siterips', 'siterips_ru'].includes(section)) return sendJson(res, 400, { ok: false, message: 'Неизвестный раздел PL' })
        const limit = Math.min(50, Math.max(10, Number(url.searchParams.get('limit') || 50) || 50))
        const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1)
        try {
            const items = await plList(section)
            return sendJson(res, 200, proxyPosters(req.headers.host, pageOf(items, page, limit)))
        } catch (error) {
            return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось получить раздел Pornolab' })
        }
    }

    if (req.method === 'GET' && url.pathname === '/pl/v1/card') {
        const topicId = String(url.searchParams.get('t') || '').replace(/\D/g, '')
        if (!topicId) return sendJson(res, 400, { ok: false, message: 'Нет id темы' })
        const light = url.searchParams.get('light') === '1'
        try {
            const card = light ? await plCardLight(topicId) : await plCard(topicId)
            card.poster = card.poster ? proxyImageUrl(req.headers.host, card.poster) : ''
            return sendJson(res, 200, card)
        } catch (error) {
            return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось получить тему Pornolab' })
        }
    }

    if (req.method === 'GET' && url.pathname === '/nm/v1/list') {
        const section = String(url.searchParams.get('section') || 'movies_new')
        if (!NM_SECTIONS[section]) return sendJson(res, 400, { ok: false, message: 'Неизвестный раздел NM' })
        const limit = Math.min(80, Math.max(10, Number(url.searchParams.get('limit') || 60) || 60))
        const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1)
        try {
            const items = await nmSection(section, NM_SECTIONS[section])
            return sendJson(res, 200, proxyPosters(req.headers.host, pageOf(items, page, limit)))
        } catch (error) {
            return sendJson(res, 502, { ok: false, message: error.message || 'Не удалось получить витрину NNM-Club' })
        }
    }

    if (req.method === 'GET' && url.pathname === '/img') {
        return handleImage(res, url.searchParams.get('url'))
    }

    if (req.method === 'GET' && (url.pathname === '/plugin.js' || url.pathname === '/nm.js' || url.pathname === '/rt.js' || url.pathname === '/pl.js' || url.pathname === '/mock-results.json')) {
        const fileMap = { '/plugin.js': 'plugin.js', '/nm.js': 'nm.js', '/rt.js': 'rt.js', '/pl.js': 'pl.js', '/mock-results.json': 'mock-results.json' }
        const file = path.join(__dirname, fileMap[url.pathname])
        try {
            const body = fs.readFileSync(file)
            res.writeHead(200, {
                'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*'
            })
            return res.end(body)
        } catch (error) {
            return sendJson(res, 500, { ok: false, message: 'Файл не найден' })
        }
    }

    return sendJson(res, 404, { ok: false, message: 'Неизвестный endpoint' })
})

server.listen(PORT, HOST, () => {
    console.log(`Lampa Kinozal API: http://${HOST}:${PORT}`)
    console.log('GET  /health')
    console.log('GET  /v1/search?q=dune&page=1&limit=10')
    console.log('POST /v1/torrents  (dry-run)')
    if (SOURCE === 'browser' && !BROWSER_CDP_URL) console.log(`Browser profile: ${BROWSER_PROFILE}`)
    if (SOURCE === 'browser' && BROWSER_CDP_URL) console.log(`Attached project Chrome: ${BROWSER_CDP_URL}`)
})

process.on('SIGINT', async () => {
    try {
        const context = browserContextPromise && await browserContextPromise
        if (context && !BROWSER_CDP_URL) await context.close()
        if (browserConnection) await browserConnection.close().catch(() => {})
    } finally {
        server.close(() => process.exit(0))
    }
})
