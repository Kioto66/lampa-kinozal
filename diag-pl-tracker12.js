// Аккуратный POST-поиск в живой вкладке с ожиданием счётчика
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.selectOption('select[name="f[]"]', '1674')
    await page.selectOption('select[name="o"]', '10')
    await page.check('input[name="s"][value="2"]')
    await page.selectOption('select[name="tm"]', '7')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(e => console.log('nav:', e.message.slice(0, 80))),
      page.evaluate(() => {
        const form = document.querySelector('form[name="tracker"]') || document.querySelector('form[action*="tracker.php"]')
        const btn = form ? Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск') : null
        if (btn) btn.click()
        else return 'кнопка не найдена'
      }),
    ])
    // ждём появления счётчика результатов
    await page.waitForFunction(() => /Результатов поиска/.test(document.body.innerText), { timeout: 20000 }).catch(() => console.log('счётчик не дождались'))
    const res = await page.evaluate(() => {
      const m = document.body.innerText.match(/Результатов поиска:\s*([0-9,\s]+)\(/)
      const rows = []
      document.querySelectorAll('tr.hl-tr').forEach(tr => {
        const a = tr.querySelector('a[href*="viewtopic.php"]')
        if (!a) return
        const seedCell = tr.querySelector('td.seedmed, td u.seed')
        const tds = Array.from(tr.cells).map(td => td.textContent.trim().replace(/\s+/g, ' '))
        rows.push({ t: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), cells: tds.slice(1, 9).map(c => c.slice(0, 14)) })
      })
      return { found: m ? m[1].trim() : '(нет счётчика)', rows: rows.slice(0, 6) }
    })
    console.log('URL:', page.url())
    console.log('Найдено:', res.found)
    res.rows.forEach(r => console.log(' ', JSON.stringify(r)))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
