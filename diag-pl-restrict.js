// Текст страницы поиска целиком (ищем предупреждения) + статистика профиля
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
    const at = text.indexOf('Поиск по раздачам')
    console.log('ФОРМА ПОИСКА:', text.slice(at, at + 1200))
    console.log('---')
    await page.goto('https://pornolab.net/forum/profile.php?mode=viewprofile&u=' + (await page.evaluate(() => {
      const m = document.body.innerText.match(/userdetails\.php\?id=(\d+)/)
      return m ? m[1] : (document.querySelector('a[href*="userdetails.php?id="]') || {}).getAttribute ? document.querySelector('a[href*="userdetails.php?id="]').getAttribute('href').match(/\d+/)[0] : ''
    })), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    const prof = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').match(/(?:Сообщений|Постов|Рейтинг[^:]*|Благодарностей)[^A-Z]{0,60}/g))
    console.log('ПРОФИЛЬ:', prof)
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
