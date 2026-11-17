// Что на странице после сабмита главной формы: текст вокруг счётчика + таблицы
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(e => console.log('nav catch:', e.message.slice(0, 60))),
      page.evaluate(() => {
        const form = Array.from(document.forms).find(f => Array.from(f.querySelectorAll('input[type="submit"]')).some(b => b.value === 'Поиск'))
        const fSel = form.querySelector('select[name="f[]"]')
        fSel.value = '1674'
        form.elements['o'].value = '10'
        form.querySelector('input[name="s"][value="2"]').checked = true
        form.elements['tm'].value = '7'
        Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }),
    ])
    await page.waitForTimeout(4000)
    const info = await page.evaluate(() => {
      const text = document.body.innerText
      const at = text.indexOf('Результатов поиска')
      const tables = Array.from(document.querySelectorAll('table')).map(t => ({ cls: t.className.slice(0, 40), rows: t.rows.length })).filter(t => t.rows > 2)
      return {
        around: text.slice(Math.max(0, at - 100), at + 600).replace(/\s+/g, ' '),
        tables,
        url: location.href,
      }
    })
    console.log('URL:', info.url)
    console.log('Вокруг счётчика:', info.around)
    console.log('Таблицы:', JSON.stringify(info.tables))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
