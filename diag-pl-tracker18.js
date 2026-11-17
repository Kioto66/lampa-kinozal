// Решающий тест: чистый сабмит формы без единого изменения (все форумы, всё время)
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const form = document.querySelector('#tr-form')
        Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }),
    ])
    await page.waitForTimeout(5000)
    const state = await page.evaluate(() => ({
      url: location.href.slice(0, 100),
      counter: (document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/) || [])[1] || '?',
      hlRows: document.querySelectorAll('tr.hl-tr').length,
      firstRows: Array.from(document.querySelectorAll('tr.hl-tr')).slice(0, 3).map(tr => {
        const a = tr.querySelector('a[href*="viewtopic.php"]')
        return a ? a.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : '(нет ссылки)'
      }),
    }))
    console.log(JSON.stringify(state, null, 1))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
