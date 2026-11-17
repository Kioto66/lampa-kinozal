// Найти темы чартов (неделя/месяц) в f=489 и вытащить группы-заголовки из чарта
const fs = require('fs')
const html = fs.readFileSync('/tmp/pl-489.html', 'utf8')
// строки-темы: <tr id="tr-..."> ... заголовок темы
const rows = html.match(/<tr id="tr-\d+"[\s\S]*?<\/tr>/g) || []
for (const row of rows) {
  const id = (row.match(/viewtopic\.php\?t=(\d+)/) || [])[1]
  const title = (row.match(/tlink[^>]*>([^<]+)</) || row.match(/class="topicTitle[^"]*"[^>]*>([^<]+)</) || row.match(/<a[^>]*>([^<]{8,80})<\/a>/) || [])[1]
  if (id) console.log(id, '|', title ? title.trim() : '(title?)')
}
