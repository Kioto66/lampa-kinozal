// Группы-разделы внутри темы-чарта: viewforum-ссылки + названия
const fs = require('fs')
const buf = fs.readFileSync('/tmp/pl-chart.html')
const html = new TextDecoder('windows-1251').decode(buf)
const start = html.indexOf('post_body" id="p-')
const end = start >= 0 ? html.indexOf('post_body-->', start) : -1
const body = start >= 0 && end > start ? html.slice(start, end) : html
const headerRe = /viewforum\.php\?f=(\d+)" class="postLink">([^<]{2,120})</g
let m
const seen = new Set()
while ((m = headerRe.exec(body)) !== null) {
  const key = m[1]
  if (seen.has(key)) continue
  seen.add(key)
  console.log('f=' + m[1], '|', m[2].trim())
}
console.log('--- items total:', (body.match(/viewtopic\.php\?t=/g) || []).length)
