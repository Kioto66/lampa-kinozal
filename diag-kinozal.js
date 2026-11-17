// Диагностика Кинозала через проектный Chrome (CDP) — что реально на странице top.php
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')

const URL = process.argv[2] || 'https://kinozal.top/top.php?t=0&d=0&f=0&c=0&k=0&j=&s=0&w=1'

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  const page = await context.newPage()
  try {
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    console.log('HTTP:', resp && resp.status())
    await page.waitForTimeout(3000)
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      stableCount: document.querySelectorAll('.stable').length,
      anchorsCount: document.querySelectorAll('.stable a[href*="/details.php?id="]').length,
      turnstile: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
      bodySnippet: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 500) : '(no body)',
      headSnippet: document.head ? document.head.innerHTML.slice(0, 400) : '',
      tables: Array.from(document.querySelectorAll('table')).map(t => t.className || '(no class)').slice(0, 10),
      loginForm: !!document.querySelector('input[name="username"], input[name="login"]')
    }))
    console.log(JSON.stringify(info, null, 2))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
