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
            return pages[0] || context.newPage()
        })()
    }
    return browserPagePromise
}

async function loadBrowserTop(category, period) {
    const categoryCode = TOP_CATEGORIES[category] || TOP_CATEGORIES.movies
    const periodCode = period === 'month' ? 2 : 1
    const url = `${KINOZAL_BASE}/top.php?t=${categoryCode}&d=0&f=0&c=0&k=0&j=&s=0&w=${periodCode}`
    const page = await getBrowserPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
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
    payload.results = payload.results.map(item => {
        if (item.poster) item.poster = proxyImageUrl(host, item.poster)
        return item
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

    if (req.method === 'GET' && url.pathname === '/img') {
        return handleImage(res, url.searchParams.get('url'))
    }

    if (req.method === 'GET' && (url.pathname === '/plugin.js' || url.pathname === '/mock-results.json')) {
        const file = path.join(__dirname, url.pathname === '/plugin.js' ? 'plugin.js' : 'mock-results.json')
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
