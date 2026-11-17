// Листовой форум напрямую + несколько f[] сразу
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')
async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  async function search(label, forums) {
    await page.goto('https://pornolab.net/forum/tracker.php', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
      page.evaluate((forums) => {
        const form = document.querySelector('#tr-form')
        const fSel = form.querySelector('select[name="f[]"]')
        Array.from(fSel.options).forEach(o => { o.selected = false })
        forums.forEach(id => {
          const opt = Array.from(fSel.options).find(o => o.value === String(id))
          if (opt) opt.selected = true
        })
        form.querySelector('select[name="o"]').value = '10'
        form.querySelector('input[name="s"][value="2"]').checked = true
        form.querySelector('select[name="tm"]').value = '7'
        Array.from(form.querySelectorAll('input[type="submit"]')).find(b => b.value === 'Поиск').click()
      }, forums),
    ])
    await page.waitForTimeout(4500)
    const state = await page.evaluate(() => {
      const counter = (document.body.innerText.match(/Результатов поиска:\s*([0-9,]+)/) || [])[1] || '?'
      const forumsSeen = new Set()
      let seeds = []
      document.querySelectorAll('table.forumline tr').forEach(tr => {
        const tds = Array.from(tr.cells)
        if (tds.length >= 10 && tds[2]) {
          forumsSeen.add(tds[2].textContent.trim().slice(0, 34))
          seeds.push(tds[8].textContent.trim())
        }
      })
      return { counter, forums: Array.from(forumsSeen).slice(0, 6), seeds: seeds.slice(0, 8) }
    })
    console.log(label, '| счётчик:', state.counter)
    console.log('   форумы:', state.forums.join(' | '))
    console.log('   колонка 8:', state.seeds.join(', '))
  }
  try {
    await search('1) листовой f[]=1877:', [1877])
    await search('2) категория по листам [902,1675,36,1830,1803,1831,1877,1878,1741,1676]:', [902, 1675, 36, 1830, 1803, 1831, 1877, 1878, 1741, 1676])
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
