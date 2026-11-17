// Перехват POST-тела + проверка состояния f[] перед отправкой
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  const posts = []
  page.on('request', req => {
    if (req.url().includes('tracker.php') && req.method() === 'POST') posts.push((req.postData() || '').slice(0, 400))
  })
  try {
    await page.goto('https://pornolab.net/forum/tracker.php', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const pre = await page.evaluate(() => {
      const form = document.querySelector('#tr-form')
      const fSel = form.querySelector('select[name="f[]"]')
      // multi-select: .value ДОБАВЛЯЕТ к выбору — предварительно снимаем все
      Array.from(fSel.options).forEach(o => { o.selected = false })
      const opt = Array.from(fSel.options).find(o => o.value === '1674')
      if (opt) opt.selected = true
      form.querySelector('input[name="fn"]').checked = true
      form.querySelector('select[name="o"]').value = '10'
      form.querySelector('input[name="s"][value="2"]').checked = true
      form.querySelector('select[name="tm"]').value = '7'
      return {
        optionExists: !!opt,
        selected: Array.from(fSel.selectedOptions).map(o => o.value),
        fn: form.querySelector('input[name="fn"]').checked,
        o: form.querySelector('select[name="o"]').value,
        s: form.querySelector('input[name="s"]:checked') ? form.querySelector('input[name="s"]:checked').value : '?',
        tm: form.querySelector('select[name="tm"]').value,
      }
    })
    console.log('Перед отправкой:', JSON.stringify(pre))
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        Array.from(document.querySelector('#tr-form').querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }),
    ])
    await page.waitForTimeout(5000)
    console.log('POST:', JSON.stringify(posts, null, 1))
    const state = await page.evaluate(() => {
      const counter = (document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/) || [])[1] || '?'
      const forums = []
      document.querySelectorAll('table.forumline tr').forEach(tr => {
        const tds = Array.from(tr.cells)
        if (tds.length > 2 && tds[2]) forums.push(tds[2].textContent.trim().slice(0, 30))
      })
      return { counter, forumsSample: forums.slice(0, 6) }
    })
    console.log('Счётчик:', state.counter, '| форумы в результатах:', state.forumsSample)
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
