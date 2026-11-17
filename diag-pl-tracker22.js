// Шапка таблицы результатов + проверка сортировки по сидам
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
        const fSel = form.querySelector('select[name="f[]"]')
        Array.from(fSel.options).forEach(o => { o.selected = false })
        ;[902, 1675, 36, 1830, 1803, 1831, 1877, 1878, 1741, 1676].forEach(id => {
          const opt = Array.from(fSel.options).find(o => o.value === String(id))
          if (opt) opt.selected = true
        })
        form.querySelector('select[name="o"]').value = '10'
        form.querySelector('input[name="s"][value="2"]').checked = true
        form.querySelector('select[name="tm"]').value = '7'
        Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }),
    ])
    await page.waitForTimeout(4500)
    const state = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table.forumline')).filter(t => t.rows.length > 5)
      const t = tables[0]
      const headers = Array.from(t.rows[0].cells).map(td => td.textContent.trim().replace(/\s+/g, ' ').slice(0, 16))
      const rows = Array.from(t.rows).slice(1, 8).map(tr => {
        const tds = Array.from(tr.cells).map(td => td.textContent.trim().replace(/\s+/g, ' '))
        return tds
      })
      return { headers, rows: rows.map(r => r.map(c => c.slice(0, 14))) }
    })
    console.log('Шапка:', JSON.stringify(state.headers))
    state.rows.forEach(r => console.log(' ', JSON.stringify(r)))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
