// Перехват POST: что уходит и что приходит
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  const posts = []
  page.on('request', req => {
    if (req.url().includes('tracker.php') && req.method() === 'POST') {
      posts.push({ url: req.url(), body: (req.postData() || '').slice(0, 500) })
    }
  })
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.selectOption('select[name="f[]"]', '1674')
    await page.selectOption('select[name="o"]', '10')
    await page.check('input[name="s"][value="2"]')
    await page.selectOption('select[name="tm"]', '7')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('form input[type="submit"]')).find(b => b.value === 'Поиск')
        if (btn) btn.click()
      }),
    ])
    await page.waitForTimeout(1500)
    console.log('POST-запросы:', JSON.stringify(posts, null, 1))
    console.log('URL:', page.url())
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
    console.log('BODY:', text)
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
