// POST-поиск трекера: заполняем форму, отправляем, читаем результаты
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.evaluate(() => {
      const form = document.querySelector('form[name="tracker"]') || document.querySelector('form[action*="tracker.php"]')
      const set = (name, value) => {
        const el = form.querySelector('[name="' + name + '"]') || form.querySelector('[name="' + name + '[]"]')
        if (el) el.value = value
      }
      set('f', '1674'); set('o', '10'); set('s', '2'); set('tm', '7')
      form.submit()
    })
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
    await page.waitForTimeout(1500)
    const res = await page.evaluate(() => {
      const m = document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/)
      const rows = []
      document.querySelectorAll('tr.hl-tr, tr[id^="tr-"]').forEach(tr => {
        const a = tr.querySelector('a[href*="viewtopic.php"]')
        if (!a) return
        const seed = tr.querySelector('.seedmed, td[title*="сид"], td:nth-child(6)')
        rows.push({ t: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), seed: seed ? seed.textContent.trim() : '?' })
      })
      return { found: m ? m[1] : '?', rows: rows.slice(0, 10) }
    })
    console.log('URL:', page.url())
    console.log('Найдено:', res.found)
    res.rows.forEach(r => console.log('  seed:' + r.seed + ' | ' + r.t))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
