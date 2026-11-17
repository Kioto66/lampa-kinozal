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

// ===== Парсер сырых тайтлов (зеркало parseTorrentTitle из api-server.js) =====
var TITLE_QUALITY_RE = /\b(WEBRip|WEB-DLRip|WEB-DL|BDRip-AVC|BDRip|BDRemux|HDTVRip|HDTV|SATRip|DVDRip|TSRip|HDRip|IPTVRip|Blu-Ray|UHD)\b.*$/i

function parseTorrentTitle(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim()
    var parts = s.split(/\s+\/\s+/)
    var original = ''
    for (var i = 1; i < parts.length; i++) {
        var part = parts[i]
        if (/^(Сезон|Серии|Часть|Пакет|Главы)/i.test(part)) break
        if (/[a-z]{3}/i.test(part) && !/[а-яё]{3}/i.test(part)) original = part
    }
    var yearMatch = s.match(/\[(\d{4})/) || s.match(/[({](\d{4})[})]/) || s.match(/\b(19\d{2}|20\d{2})\b/)
    var year = yearMatch ? Number(yearMatch[1]) : ''
    function cleanName(value) {
        return String(value || '')
            .replace(/\s*\[[^\]]*\]\s*/g, ' ')
            .replace(TITLE_QUALITY_RE, ' ')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    }
    return { search_title: cleanName(parts[0]), original_title: cleanName(original), year: year }
}

function pt(label, raw, st, ot, y) {
    var p = parseTorrentTitle(raw)
    check(label + ' [имя]', p.search_title, st)
    check(label + ' [ориг]', p.original_title, ot)
    check(label + ' [год]', String(p.year), String(y))
}

// Реальные тайтлы RT
pt('RT Чёрный пёс', 'Чёрный пёс / Сезон: 8 / Серии: 1-4 из 4 (Владимир Янковский) [2026, боевик, детектив, WEBRip 1080p]', 'Чёрный пёс', '', 2026)
pt('RT MobLand', 'Гангстерленд / MobLand / Сезон: 2 / Серии: 1-9 из 10 (Даниэль Сыркин, Гай Ричи) [2026, Великобритания, криминал, WEB-DL 1080p] MVO + Sub (Rus)', 'Гангстерленд', 'MobLand', 2026)
pt('RT Яга (варианты)', 'Яга / Баба Яга / Яга: Охота на ведьм / Yaga / Сезон: 1 / Серии: 1-4 из 8 (Дэвид Фрэйзи) [2026, Канада, ужасы] Dub + Original', 'Яга', 'Yaga', 2026)
pt('RT Полярный-17', 'Полярный (Полярный-17 ) / Сезон: 6 / Серии: 1-2 из 16 (Авет Оганесян) [2026, Комедия, HDTV 1080p]', 'Полярный', '', 2026)
pt('RT 1812 год', '1812 год (Василий Гончаров) [1912, исторический , DVDRip]', '1812 год', '', 1912)
pt('RT Синяя птичка (2 года)', 'Синяя птичка (Эраст Гарин) [1953, 1954, кино-фельето н, Betacam SP > DVDRemux]', 'Синяя птичка', '', 1953)
pt('RT Мосгаз', 'Мосгаз. Южный порт (Дело №12) / Сезон: 12 / Серии: 1-4 из 8 (Евгений Звездаков) [2026, детектив, WEBRip 1080p] + Sub (Rus)', 'Мосгаз. Южный порт', '', 2026)

// Реальные тайтлы NM
pt('NM Гражданин-мститель', 'Гражданин-мститель / Citizen Vigilante (2026) UHD BDRip [H.265/2160p] [4K, HDR10, DV 8.1, 10-bit] [MVO]', 'Гражданин-мститель', 'Citizen Vigilante', 2026)
pt('NM Быть человеком', 'Быть человеком: История Джуди Хьюман / Быть Хьюмен / Being Heumann (2026) WEB-DL [H.264/720p] [MVO]', 'Быть человеком: История Джуди Хьюман', 'Being Heumann', 2026)
pt('NM Полярный', 'Полярный (2026) WEBRip [H.264/1080p] (сезон 6, серии 1-2 из 16)', 'Полярный', '', 2026)
pt('NM А.Л.Ж.И.Р.', 'А.Л.Ж.И.Р. (2018) WEBRip [AV1/1080p] (сезон 1, серии 1-11 из 11)', 'А.Л.Ж.И.Р.', '', 2018)
pt('NM Что сказал покойник', 'Что сказал покойник (1999-2000) DVDRip [H.264] (серии 1-10 из 10)', 'Что сказал покойник', '', 1999)
pt('NM Наследник', 'Наследник / Потомок / Gwigongja (The Childe) (2023) BDRip [MVO]', 'Наследник', 'Gwigongja', 2023)
pt('NM Хатико', "Хатико: Самый верный друг / Hachiko: A Dog's Story (2009) [H.264] BDRip", 'Хатико: Самый верный друг', "Hachiko: A Dog's Story", 2009)
pt('NM Обновляемая', 'Огонь (2026) WEBRip [H.264] (сезон 1, серии 1-14 из 20) (обновляемая)', 'Огонь', '', 2026)

// Скоринг на распарсенных тайтлах
var pyosParsed = parseTorrentTitle('Чёрный пёс / Сезон: 8 / Серии: 1-4 из 4 (Владимир Янковский) [2026, боевик, детектив, WEBRip 1080p]')
check('RT Чёрный пёс: русская карточка открывается', pick([
    { id: 'ru26', name: 'Чёрный пёс', first_air_date: '2026-01-01', original_language: 'ru' },
], { title: pyosParsed.search_title, year: pyosParsed.year, type: 'series' }, 'ru'), 'ru26')
check('RT Чёрный пёс: чужая тёзка -> fallback', pick([
    { id: 'old', name: 'Чёрный пёс', first_air_date: '2007-01-01', original_language: 'tr' },
], { title: pyosParsed.search_title, year: pyosParsed.year, type: 'series' }, 'ru'), 'FALLBACK')

var mobland = parseTorrentTitle('Гангстерленд / MobLand / Сезон: 2 / Серии: 1-9 из 10 (Гай Ричи) [2026, криминал, WEB-DL 1080p]')
check('RT MobLand: по оригиналу в foreign-разделе', pick([
    { id: 'mb', name: 'Гангстерленд', original_name: 'MobLand', first_air_date: '2025-03-30', original_language: 'en' },
], { title: mobland.search_title, original_title: mobland.original_title, year: mobland.year, type: 'series' }, 'foreign'), 'mb')

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
