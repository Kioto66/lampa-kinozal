// Дамп полей формы поиска трекера
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const fields = await page.evaluate(() => {
      const form = document.querySelector('form[name="tracker"]') || document.querySelector('form[action*="tracker.php"]')
      if (!form) return 'no form'
      return Array.from(form.elements).map(el => {
        let val = el.value || ''
        if (el.tagName === 'SELECT') val = 'selected=' + (el.selectedOptions[0] ? el.selectedOptions.value || el.selectedOptions[0].textContent.trim().slice(0, 30) : '?')
        return el.tagName + ' name=[' + el.name + '] type=[' + el.type + '] val=[' + String(val).slice(0, 30) + ']'
      })
    })
    console.log(typeof fields === 'string' ? fields : fields.join('\n'))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
