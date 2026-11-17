// Диагноз 403 от nnmstatic.win: что проходит — Referer? cookies браузера?
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
const target = 'https://nnmstatic.win/forum/image.php?link=%2F%2Fs1.hostingkartinok.com%2Fuploads%2Fimages%2F2026%2F11%2F3de80' // неполный — соберём из списка
const fs = require('fs')
const d = JSON.parse(fs.readFileSync('/tmp/nm.json', 'utf8'))
const real = decodeURIComponent(d.results[1].poster.split('img?url=')[1])

async function test(label, opts) {
  try {
    const r = await fetch(real, opts)
    const b = await r.arrayBuffer()
    console.log(label, '->', r.status, r.headers.get('content-type'), b.byteLength)
  } catch (e) { console.log(label, '-> FAIL', e.message) }
}

async function main() {
  await test('bare        ', { headers: { 'User-Agent': UA }, redirect: 'follow' })
  await test('referer-club', { headers: { 'User-Agent': UA, 'Referer': 'https://nnmclub.to/' }, redirect: 'follow' })
  await test('referer-stat', { headers: { 'User-Agent': UA, 'Referer': 'https://nnmstatic.win/' }, redirect: 'follow' })
  // Ответ без follow — какой редирект/тело
  try {
    const r = await fetch(real, { headers: { 'User-Agent': UA }, redirect: 'manual' })
    console.log('manual  ->', r.status, 'location:', r.headers.get('location'), 'cf-ray:', r.headers.get('cf-ray') || '(none)')
    const b = await r.text()
    console.log('body head:', b.slice(0, 200).replace(/\s+/g, ' '))
  } catch (e) { console.log('manual FAIL', e.message) }
}
main()
