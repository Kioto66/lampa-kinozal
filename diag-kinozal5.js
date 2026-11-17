// Диагностика 5: полный outerHTML первых двух карточек новой вёрстки
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://kinozal.me/top.php?t=1&d=0&f=0&c=0&k=0&j=&s=0&w=1', { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(2500)
    const html = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/details.php?id="]')
      return a ? a.outerHTML : '(none)'
    })
    console.log(html)
  } finally { await page.close().catch(() => {}); browser.close().catch(() => {}) }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
