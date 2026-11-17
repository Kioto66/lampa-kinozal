/*
 * Тест скоринга карточек (зеркало функций из plugin.js).
 * Сценарии включают боевые промахи: «Ищейка» (русская 2016 vs The Closer 2005)
 * и «Чёрный пёс» (русский 2026 отсутствует, чужая тёзка не должна открываться).
 */
function normName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^0-9a-zа-я]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}
function nameSimilar(a, b) {
    if (!a || !b) return 0
    if (a === b) return 1
    if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return 0.9
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.7
    return 0
}
function yearScoreFor(item, result) {
    if (!item.year) return 0
    var date = result.release_date || result.first_air_date || ''
    var year = Number(String(date).slice(0, 4))
    if (!year) return 0
    var diff = year - Number(item.year)
    if (item.type === 'series') {
        if (diff <= 0 && diff >= -12) return Math.max(0.1, 1 + diff * 0.075)
        if (diff === 1 || diff === 2) return 0.5
        return 0
    }
    if (diff === 0) return 1
    if (Math.abs(diff) === 1) return 0.5
    return 0
}
function cardScore(item, result, origin) {
    var cardTitle = normName(result.name || result.title)
    var cardOrig = normName(result.original_name || result.original_title)
    var nameScore = Math.max(
        nameSimilar(cardTitle, normName(item.title)),
        item.original_title ? nameSimilar(cardOrig, normName(item.original_title)) : 0
    )
    var lang = String(result.original_language || '')
    if (origin === 'ru' && lang && lang !== 'ru') nameScore *= 0.6
    if (origin === 'foreign' && lang === 'ru') nameScore *= 0.6
    var langBonus = 0
    if (origin === 'ru' && lang === 'ru') langBonus = 0.5
    if (origin === 'foreign' && lang && lang !== 'ru') langBonus = 0.2
    return { name: nameScore, year: yearScoreFor(item, result), lang: langBonus }
}
function betterScore(a, b) {
    if (a.name !== b.name) return a.name > b.name
    if (a.year !== b.year) return a.year > b.year
    return a.lang > b.lang
}
function originOk(result, origin) {
    var lang = String(result.original_language || '')
    if (origin === 'ru') return !lang || lang === 'ru'
    if (origin === 'foreign') return !lang || lang !== 'ru'
    return true
}
function pick(pool, item, origin) {
    var bestPair = null
    pool.forEach(function (result) {
        var score = cardScore(item, result, origin)
        if (!bestPair || betterScore(score, bestPair.score)) bestPair = { score: score, result: result }
    })
    var ok = bestPair && bestPair.score.name >= 0.7 && bestPair.score.year > 0 && originOk(bestPair.result, origin)
    return ok ? bestPair.result.id : 'FALLBACK'
}

var pass = 0, fail = 0
function check(label, got, want) {
    var ok = got === want
    ok ? pass++ : fail++
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + got + (ok ? '' : ' (ожидалось: ' + want + ')'))
}

// 1. «Ищейка» (8 сезон, 2025, смешанный раздел): русская 2016 vs The Closer 2005
var ischeyka = { title: 'Ищейка', original_title: '', year: 2025, type: 'series' }
check('1a Ищейка: русская бьёт американскую', pick([
    { id: 'closer', name: 'Ищейка', original_name: 'The Closer', first_air_date: '2005-06-13', original_language: 'en' },
    { id: 'ru2016', name: 'Ищейка', original_name: 'Ищейка', first_air_date: '2016-03-01', original_language: 'ru' },
], ischeyka, ''), 'ru2016')

// 1b. То же в российском разделе: американская отсеивается жёстко
check('1b Ищейка в ru-разделе', pick([
    { id: 'closer', name: 'Ищейка', original_name: 'The Closer', first_air_date: '2005-06-13', original_language: 'en' },
    { id: 'ru2016', name: 'Ищейка', original_name: 'Ищейка', first_air_date: '2016-03-01', original_language: 'ru' },
], ischeyka, 'ru'), 'ru2016')

// 1c. Одна лишь американская в ru-разделе — fallback, не чужая карточка
check('1c только The Closer в ru-разделе -> fallback', pick([
    { id: 'closer', name: 'Ищейка', original_name: 'The Closer', first_air_date: '2005-06-13', original_language: 'en' },
], ischeyka, 'ru'), 'FALLBACK')

// 2. «Чёрный пёс» (7 сезон, 2026, смешанный раздел): русской карточки в TMDB нет
var pyos = { title: 'Чёрный пёс', original_title: '', year: 2026, type: 'series' }
check('2a Чёрный пёс: русская 2026 открывается', pick([
    { id: 'ru26', name: 'Чёрный пёс', first_air_date: '2026-01-01', original_language: 'ru' },
], pyos, ''), 'ru26')
check('2b Чёрный пёс: чужая тёзка 2007 -> fallback', pick([
    { id: 'old', name: 'Чёрный пёс', first_air_date: '2007-01-01', original_language: 'tr' },
], pyos, ''), 'FALLBACK')

// 3. «Бродяга» (1-4 сезоны, 2025, ru-раздел): тёзки из других стран
var brodyaga = { title: 'Бродяга', original_title: '', year: 2025, type: 'series' }
check('3a Бродяга: правильный среди тёзок', pick([
    { id: 'tr', name: 'Бродяга', original_name: 'Kangaroo', first_air_date: '2018-01-01', original_language: 'tr' },
    { id: 'ru', name: 'Бродяга', original_name: 'Бродяга', first_air_date: '2025-03-01', original_language: 'ru' },
], brodyaga, 'ru'), 'ru')
check('3b Бродяга: только чужие -> fallback', pick([
    { id: 'tr', name: 'Бродяга', original_name: 'Kangaroo', first_air_date: '2018-01-01', original_language: 'tr' },
], brodyaga, 'ru'), 'FALLBACK')

// 4. «Опасный» (2 сезон, 2026, ru-раздел): новый 2024 vs старый 2005
var opasny = { title: 'Опасный', original_title: '', year: 2026, type: 'series' }
check('4 Опасный: сезон-2 берёт новый', pick([
    { id: 'old', name: 'Опасный', first_air_date: '2005-01-01', original_language: 'ru' },
    { id: 'new', name: 'Опасный', first_air_date: '2024-09-01', original_language: 'ru' },
], opasny, 'ru'), 'new')

// 5. Рабочие случаи не должны сломаться
check('5a Южный порт (точное имя + год)', pick([
    { id: 'yp', name: 'Южный порт', first_air_date: '2026-01-01', original_language: 'ru' },
], { title: 'Южный порт', year: 2026, type: 'series' }, 'ru'), 'yp')
check('5b Иностранный фильм по ориг. названию', pick([
    { id: 'cv', title: 'Citizen Vigilante', original_title: 'Citizen Vigilante', release_date: '2026-02-01', original_language: 'en' },
], { title: 'Гражданин-мститель', original_title: 'Citizen Vigilante', year: 2026, type: 'movie' }, ''), 'cv')
check('5c Фильм diff=1', pick([
    { id: 'a', title: 'Фильм', release_date: '2025-01-01' },
], { title: 'Фильм', year: 2026, type: 'movie' }, ''), 'a')
check('5d Мусорный пул -> fallback', pick([
    { id: 'x1', name: 'Голубая лагуна', first_air_date: '2025-01-01' },
], brodyaga, 'ru'), 'FALLBACK')

console.log('\nИтог: ' + pass + ' ok, ' + fail + ' fail')
process.exit(fail ? 1 : 0)
