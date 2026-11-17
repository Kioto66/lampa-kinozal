// Как выглядит строка результата в /tmp/pl-top.html
const fs = require('fs')
const html = fs.readFileSync('/tmp/pl-top.html', 'utf8')
console.log('tLink:', (html.match(/tLink/g) || []).length)
console.log('tr class variants:', [...new Set((html.match(/<tr class="[^"]{0,80}"/g) || []).slice(0, 20))])
// кусок вокруг первой tLink
const at = html.indexOf('tLink')
console.log('КУСОК:', html.slice(at - 900, at + 400).replace(/\s+/g, ' '))
