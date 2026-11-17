// Отправляем ГЛАВНУЮ форму поиска (третью, с кнопкой «Поиск»)
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    await page.goto('https://pornolab.net/forum/tracker.php?f=1674', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const form = Array.from(document.forms).find(f => Array.from(f.querySelectorAll('input[type="submit"]')).some(b => b.value === 'Поиск'))
        if (!form) return 'нет главной формы'
        const set = (name, value) => {
          const el = form.elements[name] || form.querySelector('[name="' + name + '"]')
          if (el) el.value = value
        }
        const fSel = form.querySelector('select[name="f[]"]')
        if (fSel) fSel.value = '1674'
        set('o', '10')
        const s2 = form.querySelector('input[name="s"][value="2"]')
        if (s2) s2.checked = true
        set('tm', '7')
        const btn = Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск')
        btn.click()
      }),
    ])
    await page.waitForTimeout(4000)
    const state = await page.evaluate(() => {
      const rows = []
      document.querySelectorAll('tr.hl-tr, tr[id^="tr-"]').forEach(tr => {
        const a = tr.querySelector('a[href*="viewtopic.php"]')
        if (!a) return
        rows.push({
          t: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 55),
          cells: Array.from(tr.cells).map(td => td.textContent.trim().replace(/\s+/g, ' ').slice(0, 12)),
        })
      })
      return {
        counter: (document.body.innerText.match(/Результатов поиска:[^—]*/) || ['?'])[0].slice(0, 60),
        rows: rows.slice(0, 8),
      }
    })
    console.log('URL:', page.url())
    console.log('Счётчик:', state.counter)
    state.rows.forEach(r => console.log(' ', JSON.stringify(r)))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
