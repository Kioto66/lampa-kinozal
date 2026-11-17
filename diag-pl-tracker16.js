// Атрибуты главной формы и её полей
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const info = await page.evaluate(() => {
      const form = Array.from(document.forms).find(f => Array.from(f.querySelectorAll('input[type="submit"]')).some(b => b.value === 'Поиск'))
      const selects = Array.from(form.querySelectorAll('select')).map(s => ({
        name: s.name || '(пусто)',
        id: s.id || '',
        onchange: s.getAttribute('onchange') || '',
        options: s.options.length,
      }))
      return {
        attrs: {
          id: form.id, name: form.name, onsubmit: form.getAttribute('onsubmit') || '',
          action: form.action, method: form.method,
        },
        selects,
      }
    })
    console.log(JSON.stringify(info, null, 1))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
