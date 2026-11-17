// Тест /img прокси на реальных постерах NM
const fs = require('fs')
const d = JSON.parse(fs.readFileSync('/tmp/nm.json', 'utf8'))
const r = d.results || []
const urls = r.slice(0, 6).map(x => x.poster.replace('http://127.0.0.1:8787/img?url=', ''))

async function main() {
  for (const enc of urls) {
    const target = decodeURIComponent(enc)
    try {
      const t0 = Date.now()
      const resp = await fetch('http://127.0.0.1:8787/img?url=' + enc)
      const ct = resp.headers.get('content-type')
      const buf = await resp.arrayBuffer()
      console.log(resp.status, ct, buf.byteLength, (Date.now() - t0) + 'ms', target.slice(0, 110))
      if (!ct || !ct.startsWith('image/')) {
        const txt = Buffer.from(buf).toString('utf8').slice(0, 300)
        console.log('  BODY:', txt)
      }
    } catch (e) {
      console.log('FAIL', target.slice(0, 110), e.message)
    }
  }
}
main()
