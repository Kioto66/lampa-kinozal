// Где top_ru нарушает убывание сидов
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
  const d = await get('/pl/v1/list?section=top_ru&limit=60')
  const r = d.results || []
  r.forEach((x, i) => {
    if (i > 0 && (r[i - 1].seeds || 0) < (x.seeds || 0)) {
      console.log('НАРУШЕНИЕ на позиции ' + i + ': ' + (r[i - 1].seeds) + ' -> ' + (x.seeds))
      console.log('  prev:', String(r[i - 1].title).slice(0, 70))
      console.log('  curr:', String(x.title).slice(0, 70))
    }
  })
  console.log('все сиды:', r.map(x => x.seeds).join(','))
}
main()
