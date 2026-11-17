/*
 * Офлайн-тест фильтра групп чарта PL на реальном HTML темы-чарта
 * (/tmp/pl-chart.html — снят с трекера 17.11, месяц «Октябрь 2026»).
 * Зеркало новой plParseChart: проверяем, что группы-исключения вырезаны,
 * а нужные группы (русское порно, сайтрипы, трансы, гей) остались.
 */
const fs = require('fs')

const PL_DECODE = s => String(s || '')
  .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(+c))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')

const PL_IS_PHOTO = t => /(\d+\s*(?:фото|pics|images)|фотосет|\bсэт[а-я]*\b.*фото|только фото)/i.test(t)

// {skip: true} — боевой режим; иначе все группы проходят, но группа пишется в item
function parseChart(html, skip) {
  const start = html.indexOf('post_body" id="p-')
  const end = start >= 0 ? html.indexOf('post_body-->', start) : -1
  const body = start >= 0 && end > start ? html.slice(start, end) : html
  const SKIP = new Set([1670, 1672, 1717, 1800, 1723, 1745, 1838])
  const items = []
  const seen = new Set()
  const headerRe = /viewforum\.php\?f=(\d+)" class="postLink">([^<]{2,200})</g
  let topParent = 0
  let positions = []
  let m
  while ((m = headerRe.exec(body)) !== null) positions.push({ at: m.index, f: Number(m[1]), name: PL_DECODE(m[2]).trim() })
  positions.push({ at: body.length, f: 0, name: '' })
  for (let i = 0; i < positions.length - 1; i++) {
    const header = positions[i]
    if (header.f && /^https?:/i.test(header.name)) topParent = header.f
    else if (header.f && !topParent) topParent = header.f
    const skipped = SKIP.has(topParent)
    if (skipped && skip) continue
    const segment = body.slice(header.at, positions[i + 1].at)
    const itemRe = /viewtopic\.php\?t=(\d+)" class="postLink">([\s\S]{5,500}?)<\/a>([\s\S]{0,300}?post-u">\(([^)]{2,20})\))?/g
    let im
    while ((im = itemRe.exec(segment)) !== null) {
      const id = im[1]
      if (seen.has(id)) continue
      const title = PL_DECODE(im[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
      if (!title || PL_IS_PHOTO(title)) continue
      seen.add(id)
      items.push({ id, title, group: topParent })
    }
  }
  return items
}

const html = new TextDecoder('windows-1251').decode(fs.readFileSync('/tmp/pl-chart.html'))
const all = parseChart(html, false)
const filtered = parseChart(html, true)

const byGroup = g => all.filter(x => x.group === g).length
console.log('Всего в чарте:', all.length)
console.log('После фильтра:', filtered.length, '(вырезано: ' + (all.length - filtered.length) + ')')
console.log('--- Группы-исключения (должны исчезнуть):')
for (const [g, name] of [[1670, 'Эротические видео'], [1672, 'Зарубежные порнофильмы'], [1717, 'Зарубежные HD'], [1800, 'Японское/китайское'], [1723, 'Фото и журналы'], [1745, 'Хентай и манга'], [1838, 'Игры']]) {
  console.log('  f=' + g, name, ': было', byGroup(g), '-> осталось', filtered.filter(x => x.group === g).length)
}
console.log('--- Группы-остаток:')
for (const [g, name] of [[1674, 'Русское порно'], [1677, 'Сайтрипы'], [11, 'Трансы и нетрад.'], [1688, 'Гей']]) {
  console.log('  f=' + g, name, ':', filtered.filter(x => x.group === g).length)
}
console.log('--- Пример вырезанного (первые 5):')
const CUT = new Set([1670, 1672, 1717, 1800, 1723, 1745, 1838])
all.filter(x => CUT.has(x.group)).slice(0, 5).forEach(x => console.log('  [' + x.group + ']', x.title.slice(0, 70)))
console.log('--- Пример оставшегося (первые 5):')
filtered.slice(0, 5).forEach(x => console.log('  [' + x.group + ']', x.title.slice(0, 70)))

const pass = filtered.length > 0 &&
  filtered.every(x => ![1670, 1672, 1717, 1800, 1723, 1745, 1838].includes(x.group)) &&
  all.length > filtered.length &&
  filtered.some(x => x.group === 1674) && filtered.some(x => x.group === 1677)
console.log('\n' + (pass ? 'PASS' : 'FAIL'))
process.exit(pass ? 0 : 1)
