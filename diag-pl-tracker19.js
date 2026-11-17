// Полная комбинация: f[]=1674 + fn(подфорумы) + o=10 + s=2 + tm=7
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
        form.querySelector('select[name="f[]"]').value = '1674'
        form.querySelector('input[name="fn"]').checked = true
        form.querySelector('select[name="o"]').value = '10'
        form.querySelector('input[name="s"][value="2"]').checked = true
        form.querySelector('select[name="tm"]').value = '7'
        Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }),
    ])
    await page.waitForTimeout(5000)
    const state = await page.evaluate(() => {
      const counter = (document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/) || [])[1] || '?'
      // строки результатов: у торрентов свои классы — выведем классы первых строк таблицы результатов
      const tables = Array.from(document.querySelectorAll('table.forumline')).filter(t => t.rows.length > 5)
      let sample = []
      let rowClasses = []
      if (tables.length) {
        const t = tables[0]
        rowClasses = Array.from(t.rows).slice(0, 4).map(r => r.className || '(нет)')
        Array.from(t.rows).slice(1, 6).forEach(tr => {
          const a = tr.querySelector('a[href*="viewtopic.php"]')
          if (a) sample.push({
            t: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
            cells: Array.from(tr.cells).map(td => td.textContent.trim().replace(/\s+/g, ' ').slice(0, 10)),
          })
        })
      }
      return { counter, tables: tables.map(t => t.rows.length), rowClasses, sample }
    })
    console.log('Счётчик:', state.counter, '| таблицы:', state.tables)
    console.log('Классы строк:', state.rowClasses)
    state.sample.forEach(r => console.log(' ', JSON.stringify(r)))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
