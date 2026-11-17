// Живая проверка трёх новых разделов PL
const http = require('http')
function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8787' + path, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { resolve({ err: buf.slice(0, 200) }) } })
    }).on('error', reject)
  })
}
async function main() {
  for (const section of ['top_ru', 'top_clips', 'top_spec']) {
    const d = await get(`/pl/v1/list?section=${section}&limit=60`)
    const r = d.results || []
    const seeds = r.map(x => x.seeds || 0)
    const sorted = seeds.every((v, i) => i === 0 || seeds[i - 1] >= v)
    console.log('== ' + section + ': ' + r.length + ' карточек, сиды по убыванию: ' + (sorted ? 'да' : 'НЕТ'))
    r.slice(0, 3).forEach(x => console.log('   seeds:' + (x.seeds || 0), '|', String(x.title).slice(0, 65)))
    if (d.notice) console.log('   notice:', d.notice)
  }
}
main()
