// «Чёрный пёс» и «Ищейка» в месячных топах Кинозала — точные поля
const http = require('http')
function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8787' + path, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { resolve({ err: e.message }) } })
    }).on('error', reject)
  })
}
const rx = /пёс|пес|ищейка/i
async function main() {
  for (const category of ['series', 'series_ru', 'series_foreign', 'movies']) {
    for (const period of ['week', 'month']) {
      const d = await get(`/v1/search?category=${category}&period=${period}&page=1&limit=50`)
      const r = d.results || []
      r.forEach(x => {
        if (rx.test(x.title)) console.log(category, period, JSON.stringify({ t: x.title, o: x.original_title, y: x.year, type: x.type, origin: x.origin || null }))
      })
      if (r.length >= 50) {
        // вторая страница
        const d2 = await get(`/v1/search?category=${category}&period=${period}&page=2&limit=50`)
        ;(d2.results || []).forEach(x => { if (rx.test(x.title)) console.log(category, period, 'p2', JSON.stringify({ t: x.title, o: x.original_title, y: x.year, type: x.type, origin: x.origin || null })) })
      }
    }
  }
  console.log('done')
}
main()
