// Поля карточек RT и NM — что доступно скорингу
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
const rx = /пёс|ищейка/i
async function main() {
  const rt = await get('/rt/v1/list?section=series_ru&page=1&limit=80')
  const rtr = (rt.results || []).filter(x => rx.test(x.title || ''))
  console.log('RT fields:', rtr.map(x => JSON.stringify({ t: (x.title||'').slice(0,40), o: x.original_title, y: x.year, type: x.type, origin: x.origin })))
  const nm = await get('/nm/v1/list?section=series_ru&page=1&limit=80')
  const nmr = (nm.results || []).slice(0, 2)
  console.log('NM sample:', nmr.map(x => JSON.stringify({ t: (x.title||'').slice(0,40), o: x.original_title, y: x.year, type: x.type, origin: x.origin })))
}
main()
