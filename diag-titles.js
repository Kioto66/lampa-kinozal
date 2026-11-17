// Живые образцы сырых тайтлов RT и NM — материал для проектирования парсера
const http = require('http')
function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8787' + path, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve(JSON.parse(buf)))
    }).on('error', reject)
  })
}
async function main() {
  const targets = [
    ['RT series_ru', '/rt/v1/list?section=series_ru&page=1&limit=80'],
    ['RT movies_ru', '/rt/v1/list?section=movies_ru&page=1&limit=80'],
    ['RT series_foreign', '/rt/v1/list?section=series_foreign&page=1&limit=80'],
    ['NM series_ru', '/nm/v1/list?section=series_ru&page=1&limit=80'],
    ['NM movies_new', '/nm/v1/list?section=movies_new&page=1&limit=80'],
    ['NM movies_foreign', '/nm/v1/list?section=movies_foreign&page=1&limit=80'],
  ]
  for (const [label, path] of targets) {
    const d = await get(path)
    const r = d.results || []
    console.log('== ' + label + ' (' + r.length + ')')
    r.slice(0, 12).forEach(x => console.log('  ' + JSON.stringify({ t: x.title, y: x.year, o: x.original_title || undefined, type: x.type })))
  }
}
main()
