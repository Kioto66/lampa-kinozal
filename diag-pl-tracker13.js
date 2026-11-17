// Диагностика сабмита: все навигации + наличие таблицы результатов
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV:', f.url().slice(0, 110)) })
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const formInfo = await page.evaluate(() => {
      const forms = Array.from(document.forms).map((f, i) => ({ i, name: f.name, action: f.action, method: f.method, submits: Array.from(f.querySelectorAll('input[type="submit"]')).map(b => b.value) }))
      return forms
    })
    console.log('Формы:', JSON.stringify(formInfo))
    await page.selectOption('select[name="f[]"]', '1674')
    await page.selectOption('select[name="o"]', '10')
    await page.check('input[name="s"][value="2"]')
    await page.selectOption('select[name="tm"]', '7')
    // Кликаем по кнопке «Поиск» по-настоящему
    const clicked = await page.evaluate(() => {
      const form = document.querySelector('form[name="tracker"]') || Array.from(document.forms).find(f => /tracker\.php/.test(f.action))
      if (!form) return 'нет формы'
      const btn = Array.from(form.querySelectorAll('input[type="submit"]')).find(b => /поиск/i.test(b.value))
      if (!btn) return 'нет кнопки: ' + form.querySelectorAll('input[type=submit]').length
      btn.click()
      return 'кликнули: ' + btn.value
    })
    console.log('Клик:', clicked)
    await page.waitForTimeout(6000)
    const state = await page.evaluate(() => ({
      url: location.href.slice(0, 110),
      hlRows: document.querySelectorAll('tr.hl-tr').length,
      anyRows: document.querySelectorAll('tr[id^="tr-"]').length,
      counter: (document.body.innerText.match(/Результатов поиска:[^—]*/) || ['?'])[0].slice(0, 60),
      firstRow: document.querySelector('tr.hl-tr') ? document.querySelector('tr.hl-tr').textContent.trim().replace(/\s+/g, ' ').slice(0, 130) : null
    }))
    console.log('Состояние:', JSON.stringify(state, null, 1))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
