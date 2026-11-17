// POST-поиск из залогиненной вкладки через fetch — как будет делать сервер.
// Сохраняем HTML результатов и разбираем структуру строки.
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
const fs = require('fs')

const FORUMS = [902, 1675, 36, 1830, 1803, 1831, 1877, 1878, 1741, 1676] // Русское порно

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/index.php', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const html = await page.evaluate(async (forums) => {
      const params = new URLSearchParams()
      params.append('prev_my', '0'); params.append('prev_new', '0'); params.append('prev_oop', '0')
      params.append('prev_sfl', '0'); params.append('prev_stg', '0')
      forums.forEach(id => params.append('f[]', String(id)))
      params.append('o', '10'); params.append('s', '2'); params.append('tm', '7')
      params.append('df', ''); params.append('dt', ''); params.append('pn', '')
      params.append('fsz', ''); params.append('nm', ''); params.append('mw', '')
      const r = await fetch('/forum/tracker.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        credentials: 'include',
      })
      const buf = await r.arrayBuffer()
      return new TextDecoder('windows-1251').decode(buf)
    }, FORUMS)
    fs.writeFileSync('/tmp/pl-top.html', html)
    console.log('len:', html.length, '| счётчик:', (html.match(/Результатов поиска:\s*([0-9,]+)/) || [])[1])

    // Разбор: таблица результатов → строки
    const start = html.indexOf('<!--.tr.i-->') >= 0 ? html.indexOf('<!--tr.i-->') : html.indexOf('tracker')
    const rows = html.match(/<tr class="hl-tr[\s\S]*?<\/tr>/g) || html.match(/<tr id="tr-\d+"[\s\S]*?<\/tr>/g) || []
    console.log('строк hl-tr:', (html.match(/hl-tr/g) || []).length, '| строк tr-N:', (html.match(/<tr id="tr-\d+"/g) || []).length)
    //_dump первой строки с tLink
    const row = rows.find(r => r.includes('tLink')) || rows[0] || ''
    console.log('ROW:', row.replace(/\s+/g, ' ').slice(0, 2000))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
