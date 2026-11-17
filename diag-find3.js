// Поиск «Чёрный пёс» по всем категориям и страницам Кинозала
const http = require('http')
const BASE = 'http://127.0.0.1:8787'

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve(JSON.parse(buf)))
    }).on('error', reject)
  })
}

async function main() {
  const rx = /пёс|черн|бродяга/i
  for (const category of ['series_ru', 'series', 'movies']) {
    for (let page = 1; page <= 3; page++) {
      try {
        const d = await get(`/v1/search?category=${category}&page=${page}&limit=50`)
        const r = d.results || []
        r.forEach(x => {
          if (rx.test(x.title)) console.log(category, 'p' + page, JSON.stringify({ t: x.title, o: x.original_title, y: x.year, type: x.type }))
        })
        if (r.length < 50) break
      } catch (e) { console.log(category, page, 'ERR', e.message); break }
    }
  }
  console.log('done')
}
main()
