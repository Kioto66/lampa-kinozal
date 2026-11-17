// Диагностика 4: новая вёрстка top.php — точная структура карточки (img, title), по категориям
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')

const cats = [
  ['movies', 'https://kinozal.me/top.php?t=1&d=0&f=0&c=0&k=0&j=&s=0&w=1'],
  ['series', 'https://kinozal.me/top.php?t=3&d=0&f=0&c=0&k=0&j=&s=0&w=1'],
]

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  for (const [name, url] of cats) {
    const page = await context.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForTimeout(2500)
      const info = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href^="/details.php?id="]'))
        const a = anchors[0]
        return {
          count: anchors.length,
          first: a ? { title: (a.getAttribute('title') || '').slice(0, 100), img: a.querySelector('img') ? a.querySelector('img').src.slice(0, 120) : null, cls: a.className } : null,
          withImg: anchors.filter(x => x.querySelector('img')).length,
          withTitle: anchors.filter(x => (x.getAttribute('title') || '').length > 5).length
        }
      })
      console.log(name, JSON.stringify(info, null, 1))
    } finally { await page.close().catch(() => {}) }
  }
  browser.close().catch(() => {})
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
