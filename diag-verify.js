// Проверка результатов после фиксов
const fs = require('fs')

function report(label, file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const r = d.results || []
  const withPoster = r.filter(x => x.poster).length
  console.log(`== ${label}: items=${r.length} withPoster=${withPoster}`)
  r.slice(0, 3).forEach(x => console.log('  -', (x.title || '').slice(0, 55), '|', (x.year || ''), '| poster:', String(x.poster || '(EMPTY)').slice(0, 80)))
  return r
}

const movies = report('Кинозал movies', '/tmp/kz-movies.json')
const series = report('Кинозал series', '/tmp/kz-series.json')
const nm = report('NNM movies_new', '/tmp/nm.json')

// Тянем 3 постера Кинозала (img2me.org — новый хост) и 4 постера NNM через /img
async function pull(label, url) {
  try {
    const r = await fetch(url)
    const b = await r.arrayBuffer()
    const ct = r.headers.get('content-type')
    console.log(label, '->', r.status, ct, b.byteLength)
    if (!(ct || '').startsWith('image/')) console.log('  BODY:', Buffer.from(b).toString('utf8').slice(0, 200))
  } catch (e) { console.log(label, 'FAIL', e.message) }
}

async function main() {
  for (const x of movies.slice(0, 3)) await pull('KZ img2me ', x.poster)
  for (const x of nm.slice(0, 4)) await pull('NM static  ', x.poster)
}
main()
