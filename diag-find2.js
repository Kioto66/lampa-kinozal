// Раздачи «Чёрный пёс» и «Ищейка» в series_ru/series у Кинозала
const fs = require('fs')
function show(file, label) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const r = d.results || []
  console.log('==', label, 'total page1:', r.length)
  r.forEach(x => {
    if (/пёс|пес|ищейка/i.test(x.title)) console.log(JSON.stringify({ title: x.title, original_title: x.original_title, year: x.year, type: x.type, origin: x.origin || null, source_url: x.source_url }))
  })
}
show('/tmp/kz-sru2.json', 'series_ru')
show('/tmp/kz-s-all.json', 'series (смешанный)')
