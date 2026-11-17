// Полный ответ после POST: ищем счётчик и первые строки таблицы
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    const resp = await page.request.post('https://pornolab.net/forum/tracker.php', {
      form: { prev_my: '0', prev_new: '0', prev_oop: '0', prev_sfl: '0', prev_stg: '0', 'f[]': '1674', o: '10', s: '2', tm: '7', df: '', dt: '', pn: '', fsz: '', nm: '', mw: '' },
      headers: { 'Referer': 'https://pornolab.net/forum/tracker.php?f=1674' },
      maxRedirects: 5,
    })
    console.log('HTTP:', resp.status())
    const buf = await resp.body()
    const decoded = new TextDecoder('windows-1251').decode(buf)
    const idx = decoded.search(/Результатов|Найдено/)
    console.log('idx:', idx)
    const m = decoded.match(/Результатов поиска:\s*([0-9,\s]+)/)
    console.log('Счётчик:', m ? m[1].trim() : '(нет)')
    // первые названия раздач
    const titles = [...decoded.matchAll(/t=[0-9]+"[^>]*>([^<]{10,120})</g)].slice(0, 8)
    titles.forEach(t => console.log(' -', t[1].replace(/\s+/g, ' ').slice(0, 80)))
  } finally {
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
