// POST главной формы с дефолтами (только f[]), потом с параметрами
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  async function submitAndRead(label) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const form = document.querySelector('#tr-form')
        Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }),
    ])
    await page.waitForTimeout(4000)
    const state = await page.evaluate(() => ({
      counter: (document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/) || [])[1] || '?',
      hlRows: document.querySelectorAll('tr.hl-tr').length,
      rowsAny: document.querySelectorAll('table.forumline tr').length,
      firstHl: document.querySelector('tr.hl-tr') ? document.querySelector('tr.hl-tr').textContent.trim().replace(/\s+/g, ' ').slice(0, 90) : null,
    }))
    console.log(label, '| счётчик:', state.counter, '| hl-строк:', state.hlRows, '| строк таблицы:', state.rowsAny, '| первая:', state.firstHl)
  }
  try {
    await page.goto('https://pornolab.net/forum/tracker.php', { waitUntil: 'domcontentloaded', timeout: 30000 })
    // 1: только категория, всё остальное дефолт
    await page.evaluate(() => { document.querySelector('#tr-form select[name="f[]"]').value = '1674' })
    await submitAndRead('1) f=1674, дефолты')
    // 2: + сиды по убыванию
    await page.evaluate(() => {
      const form = document.querySelector('#tr-form')
      form.querySelector('select[name="f[]"]').value = '1674'
      form.querySelector('select[name="o"]').value = '10'
      form.querySelector('input[name="s"][value="2"]').checked = true
    })
    await submitAndRead('2) + o=10 s=2')
    // 3: + неделя
    await page.evaluate(() => {
      const form = document.querySelector('#tr-form')
      form.querySelector('select[name="f[]"]').value = '1674'
      form.querySelector('select[name="o"]').value = '10'
      form.querySelector('input[name="s"][value="2"]').checked = true
      form.querySelector('select[name="tm"]').value = '7'
    })
    await submitAndRead('3) + tm=7')
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
