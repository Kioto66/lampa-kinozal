// Что реально на странице tracker.php с параметрами
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    const resp = await page.goto('https://pornolab.net/forum/tracker.php?f=1674&tm=7&o=10&s=2', { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log('URL после загрузки:', page.url())
    console.log('HTTP:', resp && resp.status(), '| title:', await page.title())
    const text = await page.evaluate(() => document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 600) : '(no body)')
    console.log('BODY:', text)
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
