// Заполнить форму поиска трекера как пользователь и отправить — смотрим итоговый URL
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const url = await page.evaluate(() => {
      const form = document.querySelector('form[name="tracker"]') || document.querySelector('form[action*="tracker.php"]') || document.querySelectorAll('form')[1] || document.querySelectorAll('form')[0]
      if (!form) return '(form not found: ' + document.forms.length + ' forms)'
      const set = (name, value) => {
        const el = form.querySelector('[name="' + name + '"]') || form.querySelector('[name="' + name + '[]"]')
        if (el) el.value = value
      }
      set('f', '1674')
      set('o', '10')
      set('s', '2')
      set('tm', '7')
      return 'action=' + form.action + ' method=' + form.method + ' name=' + form.name
    })
    console.log(url)
    // Отправляем и смотрим, куда уходим
    await page.evaluate(() => {
      const form = document.querySelector('form[name="tracker"]') || document.querySelector('form[action*="tracker.php"]')
      if (form) form.submit()
    })
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
    console.log('Итоговый URL:', page.url())
    const res = await page.evaluate(() => {
      const m = document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/)
      const rows = document.querySelectorAll('tr.hl-tr, tr[id^="tr-"]').length
      return { found: m ? m[1] : '?', rows }
    })
    console.log(JSON.stringify(res))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
