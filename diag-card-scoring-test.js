/*
 * Тест скоринга карточек (зеркало функций из plugin.js) на проблемных случаях:
 * «Бродяга», «Опасный» (2 сезон), иностранный фильм, мусорный пул → fallback.
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
        if (diff <= 0 && diff >= -6) return 1 + diff * 0.1
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
function pick(pool, item, origin) {
    var bestPair = null
    pool.forEach(function (result) {
        var score = cardScore(item, result, origin)
        if (!bestPair || betterScore(score, bestPair.score)) bestPair = { score: score, result: result }
    })
    return bestPair && bestPair.score.name >= 0.7 ? bestPair.result.id : 'FALLBACK'
}

var pass = 0, fail = 0
function check(label, got, want) {
    var ok = got === want
    ok ? pass++ : fail++
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + got + (ok ? '' : ' (ожидалось: ' + want + ')'))
}

// 1. «Бродяга»: чужие сериалы-тёзки + правильный российский 2025
var brodyaga = { title: 'Бродяга', original_title: '', year: 2025, type: 'series' }
check('1a правильный среди тёзок', pick([
    { id: 'tr', name: 'Бродяга', original_name: 'Kangaroo', first_air_date: '2018-01-01', original_language: 'tr' },
    { id: 'ru', name: 'Бродяга', original_name: 'Бродяга', first_air_date: '2025-03-01', original_language: 'ru' },
], brodyaga, 'ru'), 'ru')

// 1b. Только чужие тёзки — fallback, а не чужая карточка
check('1b только чужие -> fallback', pick([
    { id: 'tr', name: 'Бродяга', original_name: 'Kangaroo', first_air_date: '2018-01-01', original_language: 'tr' },
], brodyaga, 'ru'), 'FALLBACK')

// 1c. Совсем мусорный пул
check('1c мусор -> fallback', pick([
    { id: 'x1', name: 'Голубая лагуна', first_air_date: '2025-01-01' },
    { id: 'x2', name: 'Слов пацана', first_air_date: '2023-01-01' },
], brodyaga, 'ru'), 'FALLBACK')

// 2. «Опасный» 2 сезон: правильный стартовал в 2024 (diff=2), старый «Опасный» 2005
var opasny = { title: 'Опасный', original_title: '', year: 2026, type: 'series' }
check('2a сезон-2 берёт новый', pick([
    { id: 'old', name: 'Опасный', first_air_date: '2005-01-01', original_language: 'ru' },
    { id: 'new', name: 'Опасный', first_air_date: '2024-09-01', original_language: 'ru' },
], opasny, 'ru'), 'new')

// 2b. «Опасный бизнес» (префикс) не должен победить точное «Опасный» без года
check('2b точное имя сильнее префикса', pick([
    { id: 'biz', name: 'Опасный бизнес', first_air_date: '2026-01-01', original_language: 'ru' },
    { id: 'ex', name: 'Опасный', first_air_date: '2024-01-01', original_language: 'ru' },
], opasny, 'ru'), 'ex')

// 3. Иностранный фильм: поиск по оригинальному названию
var vigi = { title: 'Гражданин-мститель', original_title: 'Citizen Vigilante', year: 2026, type: 'movie' }
check('3 иностранный по ориг. названию', pick([
    { id: 'cv', title: 'Citizen Vigilante', original_title: 'Citizen Vigilante', release_date: '2026-02-01', original_language: 'en' },
], vigi, ''), 'cv')

// 3b. Русский перевод названия в карточке тоже матчится
check('3b матч по русскому названию', pick([
    { id: 'cv', title: 'Гражданин-мститель', original_title: 'Citizen Vigilante', release_date: '2026-02-01', original_language: 'en' },
], vigi, ''), 'cv')

// 4. Южный порт: точное имя, год совпал
var yuzhny = { title: 'Южный порт', original_title: '', year: 2026, type: 'series' }
check('4 южный порт', pick([
    { id: 'yp', name: 'Южный порт', first_air_date: '2026-01-01', original_language: 'ru' },
], yuzhny, 'ru'), 'yp')

// 5. Год сериала ±1 (TMDB знает дату на год раньше раздачи)
check('5 серия diff=-1 проходит', pick([
    { id: 'a', name: 'Слов пацана', first_air_date: '2022-01-01', original_language: 'ru' },
], { title: 'Слов пацана', year: 2023, type: 'series' }, 'ru'), 'a')

// 6. Фильм с годом ±1 — только половинный балл, но при отсутствии лучше — проходит
check('6 фильм diff=1 проходит при отсутствии точного', pick([
    { id: 'a', title: 'Фильм', release_date: '2025-01-01' },
], { title: 'Фильм', year: 2026, type: 'movie' }, ''), 'a')

console.log('\nИтог: ' + pass + ' ok, ' + fail + ' fail')
process.exit(fail ? 1 : 0)
