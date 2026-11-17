// Диагностика 3: где на top.php реальные ссылки раздач; iframe'ы; динамика
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
      const real = Array.from(document.querySelectorAll('a[href^="/details.php?id="], a[href*="/details.php?id="]'))
        .filter(a => /(^|\/)details\.php\?id=/.test(a.getAttribute('href')))
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src)
      const bodyHtml = document.body.innerHTML
      const idx = bodyHtml.indexOf('details.php')
      return {
        realAnchors: real.length,
        firstReal: real[0] ? { href: real[0].getAttribute('href'), title: (real[0].title || real[0].textContent || '').slice(0, 120), chain: (() => { let c = [], e = real[0]; while (e && e !== document.body && c.length < 10) { c.push(e.tagName.toLowerCase() + (e.className ? '.' + e.className : '')); e = e.parentElement } return c })() } : null,
        iframes,
        bodyLength: bodyHtml.length,
        aroundDetails: idx >= 0 ? bodyHtml.slice(Math.max(0, idx - 800), idx + 400) : '(details.php not in body html)'
      }
    })
    console.log(JSON.stringify(info, null, 2))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
