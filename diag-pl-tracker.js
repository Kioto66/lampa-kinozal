// Открыть tracker.php?f=1674 в залогиненном Chrome (CDP), вытащить параметры формы поиска
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    const resp = await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log('HTTP:', resp && resp.status(), '| logged in:', /выход|logout/i.test(await page.content()) ? 'да' : 'нет')
    const form = await page.evaluate(() => {
      const out = {}
      const selects = document.querySelectorAll('form select[name]')
      selects.forEach(s => {
        const opts = Array.from(s.options).map(o => o.value + '=' + o.textContent.trim().slice(0, 40))
        out['select:' + s.name] = opts
      })
      const hidden = document.querySelectorAll('form input[type="hidden"][name]')
      const h = {}
      hidden.forEach(i => h[i.name] = i.value)
      out.hidden = h
      return out
    })
    console.log(JSON.stringify(form, null, 1).slice(0, 4000))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
