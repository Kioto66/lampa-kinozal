// Поиск через нативные взаимодействия: selectOption + check + click «Поиск»
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
    // Снимаем дефолтные галочки, которые могут обнулять выборку
    for (const name of ['new', 'oop', 'my', 'bmk', 'dlw', 'dlc']) {
      await page.evaluate(n => {
        const el = document.querySelector('input[name="' + n + '"]')
        if (el && el.checked) el.click()
      }, name)
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('form input[type="submit"]')).find(b => b.value === 'Поиск')
        if (btn) btn.click()
      }),
    ])
    await page.waitForTimeout(1500)
    const res = await page.evaluate(() => {
      const m = document.body.innerText.match(/Результатов поиска:\s*([0-9,\s]+)/)
      const rows = []
      document.querySelectorAll('tr.hl-tr, tr[id^="tr-"]').forEach(tr => {
        const a = tr.querySelector('a[href*="viewtopic.php"]')
        if (!a) return
        const tds = Array.from(tr.cells).map(td => td.textContent.trim().replace(/\s+/g, ' '))
        rows.push({ t: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 55), cells: tds.slice(0, 10).map(c => c.slice(0, 12)) })
      })
      return { found: m ? m[1].trim() : '?', rows: rows.slice(0, 8) }
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
