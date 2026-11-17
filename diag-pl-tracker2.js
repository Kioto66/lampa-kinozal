// Параметры сортировки и периода в tracker.php + живая проверка URL
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const form = await page.evaluate(() => {
      const out = {}
      document.querySelectorAll('form select[name]').forEach(s => {
        if (s.name === 'f') return
        out[s.name] = Array.from(s.options).map(o => o.value + ' = ' + o.textContent.trim().slice(0, 50))
      })
      return out
    })
    console.log(JSON.stringify(form, null, 1))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
