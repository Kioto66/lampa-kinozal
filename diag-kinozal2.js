// Диагностика 2: какая структура теперь на top.php у Кинозала
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')

const URL = process.argv[2] || 'https://kinozal.me/top.php?t=0&d=0&f=0&c=0&k=0&j=&s=0&w=1'

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  const page = await context.newPage()
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(4000)
    const info = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="details.php?id="]'))
      const first = anchors[0]
      const chain = []
      let el = first
      while (el && el !== document.body && chain.length < 12) {
        chain.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`)
        el = el.parentElement
      }
      return {
        anchorsTotal: anchors.length,
        firstChain: chain,
        firstHTML: first ? first.outerHTML.slice(0, 300) : null,
        containerHTML: first ? (first.closest('table') || first.closest('div') || document.body).outerHTML.slice(0, 1500) : null,
        classesSample: Array.from(new Set(Array.from(document.querySelectorAll('table,div[class],td[class]')).map(e => e.tagName.toLowerCase() + '.' + e.className).filter(c => /stab|tbl|list|top|result/i.test(c)))).slice(0, 20)
      }
    })
    console.log(JSON.stringify(info, null, 2))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
