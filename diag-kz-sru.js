// Что сервер отдаёт по проблемным сериалам (Кинозал, series_ru)
const fs = require('fs')
const d = JSON.parse(fs.readFileSync('/tmp/kz-sru.json', 'utf8'))
const r = d.results || []
console.log('total in page1:', r.length)
const rx = /Бродяга|Чёрный пёс|Черный пёс|Опасный/i
r.forEach(x => {
  if (rx.test(x.title)) console.log(JSON.stringify({ title: x.title, original_title: x.original_title, year: x.year, type: x.type }))
})
// и первые 8 для контекста — что вообще в разделе
console.log('--- sample:')
r.slice(0, 8).forEach(x => console.log('-', (x.title || '').slice(0, 70), '| orig:', (x.original_title || '(нет)').slice(0, 40), '|', x.year))
