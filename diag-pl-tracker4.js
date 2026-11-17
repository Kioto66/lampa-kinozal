// Структура таблицы результатов tracker.php
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f[]=1674&tm=7&o=10&s=2', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const info = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table')).map(t => ({ cls: t.className, rows: t.rows.length }))
      const row = document.querySelector('tr.hl-tr, tr[id^="tr-"]')
      const cells = row ? Array.from(row.cells).map(td => (td.className || '-') + ' | ' + td.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)) : null
      return { tables: tables.filter(t => t.rows > 3), firstRow: cells }
    })
    console.log(JSON.stringify(info, null, 1))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
