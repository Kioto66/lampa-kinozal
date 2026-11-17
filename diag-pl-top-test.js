// Офлайн-тест plParseTrackerTop на реальном HTML (/tmp/pl-top.html, снят через fetch POST)
const fs = require('fs')

const PL_DECODE = s => String(s || '')
  .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(+c))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')

const PL_IS_PHOTO = t => /(\d+\s*(?:фото|pics|images)|фотосет|\bсэт[а-я]*\b.*фото|только фото)/i.test(t)

function plUnDouble(s) {
  s = String(s || '')
  if (s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2)) return s.slice(0, s.length / 2)
  return s
}

function plParseTrackerTop(html) {
  const items = []
  const seen = new Set()
  for (const row of (html.match(/<tr class="tCenter">[\s\S]*?<\/tr>/g) || [])) {
    const tMatch = row.match(/tLink[^>]*href="[^"]*viewtopic\.php\?t=(\d+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!tMatch) continue
    const id = tMatch[1]
    if (seen.has(id)) continue
    const title = PL_DECODE(tMatch[2].replace(/<wbr>/gi, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (!title || PL_IS_PHOTO(title)) continue
    seen.add(id)
    const sizeHuman = PL_DECODE((row.match(/dl\.php\?t=\d+"[^>]*>([^<]+)</) || [])[1] || '').replace(/&nbsp;/g, ' ').trim()
    const seedDigits = (row.match(/<b class="seedmed">(\d+)<\/b>/) || [])[1] || (row.match(/<td class="row4 seedmed">([\s\S]*?)<\/td>/) || ['', ''])[1].replace(/\D/g, '')
    items.push({ id, title, size: sizeHuman, seeds: Number(plUnDouble(seedDigits)) || 0 })
  }
  return items
}

const html = fs.readFileSync('/tmp/pl-top.html', 'utf8')
const items = plParseTrackerTop(html)
console.log('Разобрано карточек:', items.length)

let pass = 0, fail = 0
function check(label, got, want) {
  const ok = got === want
  ok ? pass++ : fail++
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + got + (ok ? '' : ' (ожидалось: ' + want + ')'))
}
check('есть карточки (50 на страницу)', Math.min(items.length, 50), 50)
check('сортировка по сидам не возрастает', items.every((x, i) => i === 0 || items[i - 1].seeds >= x.seeds) ? 'да' : 'нет', 'да')
check('id числовые', items.every(x => /^\d+$/.test(x.id)) ? 'да' : 'нет', 'да')
check('размер заполнен', items.filter(x => x.size).length + ' шт', items.length + ' шт')
console.log('Примеры:')
items.slice(0, 5).forEach(x => console.log('  seeds:' + x.seeds, '|', x.size, '|', x.title.slice(0, 70)))
console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' ok, ' + fail + ' fail)')
process.exit(fail ? 1 : 0)
