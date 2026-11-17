// Анализ выдачи NM: сколько карточек с постерами, примеры
const fs = require('fs')
const d = JSON.parse(fs.readFileSync('/tmp/nm.json', 'utf8'))
const r = d.results || []
const withP = r.filter(x => x.poster).length
console.log('ok:', d.ok, 'items:', r.length, 'withPoster:', withP, 'notice:', d.notice || '(none)')
r.slice(0, 8).forEach(x => console.log('-', (x.title || '').slice(0, 48), '| poster:', String(x.poster || '(EMPTY)').slice(0, 100)))
