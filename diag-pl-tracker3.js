// Живая проверка: tracker.php?f[]=1674&tm=7&o=10&s=2 — сиды по убыванию за неделю?
const playwright = require('/home/kioto/lampa/node_modules/playwright-core')

async function main() {
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].newPage()
  try {
    const resp = await page.goto('https://pornolab.net/forum/tracker.php?f[]=1674&tm=7&o=10&s=2', { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log('HTTP:', resp && resp.status())
    const rows = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const a = tr.querySelector('a.tLink, a[href*="viewtopic.php"]')
        if (!a) return
        const title = a.textContent.trim().slice(0, 60)
        // сиды: колонка с class="seedmed" или соседние td
        const seed = tr.querySelector('.seedmed, td:nth-child(7)')
        const date = tr.querySelector('td:nth-child(11), u')
        out.push({ title, seed: seed ? seed.textContent.trim() : '?', date: date ? date.textContent.trim() : '?' })
      })
      return out.slice(0, 12)
    })
    rows.forEach(r => console.log(JSON.stringify(r)))
  } finally {
    await page.close().catch(() => {})
    browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
