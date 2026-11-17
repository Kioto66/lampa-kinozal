// Хвост первой строки: автор/размер/сид/личи/дата
const fs = require('fs')
const html = fs.readFileSync('/tmp/pl-top.html', 'utf8')
const rows = html.match(/<tr class="tCenter">[\s\S]*?<\/tr>/g) || []
console.log('строк tCenter:', rows.length)
const row = rows.find(r => r.includes('tLink'))
const cells = row.match(/<td class="[^"]*">[\s\S]*?<\/td>/g) || []
cells.forEach((c, i) => {
  const inner = c.replace(/\s+/g, ' ')
  console.log(i, '|', inner.slice(0, 260))
})
