param([switch]$Stop)

# Управление системой «Кинозал для LAMPA»:
#   запуск  — проектный Chrome (порт 9222) + API-сервер (порт 8787, режим browser)
#   -Stop   — остановить оба
$ErrorActionPreference = 'SilentlyContinue'
$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$prof   = Join-Path $dir '.kinozal-manual-profile'

function Test-Url($url) {
    try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true }
    catch { return $false }
}

if ($Stop) {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match 'api-server' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
        Where-Object { $_.CommandLine -match 'kinozal-manual-profile' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Host 'Кинозал: сервер и проектный Chrome остановлены.' -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    exit 0
}

# 1) Chrome с проектным профилем — через него сервер читает страницы Кинозала
if (Test-Url 'http://127.0.0.1:9222/json/version') {
    Write-Host 'Проектный Chrome уже запущен.' -ForegroundColor Gray
} else {
    Write-Host 'Запускаю проектный Chrome (профиль .kinozal-manual-profile)...'
    Start-Process $chrome -ArgumentList @(
        '--remote-debugging-port=9222',
        "--user-data-dir=$prof",
        '--no-first-run', '--no-default-browser-check',
        '--window-size=1280,900',
        'https://kinozal.me/'
    )
    $ok = $false
    foreach ($i in 1..15) {
        Start-Sleep -Seconds 1
        if (Test-Url 'http://127.0.0.1:9222/json/version') { $ok = $true; break }
    }
    if ($ok) {
        Write-Host 'Chrome готов. Это окно НЕЛЬЗЯ закрывать, пока пользуешься Кинозалом (можно свернуть).' -ForegroundColor Cyan
    } else {
        Write-Host 'Chrome не ответил на порту 9222 — проверь его окно вручную.' -ForegroundColor Red
    }
}

# 2) API-сервер на 8787 — его адрес прописан в настройках плагина LAMPA
if (Test-Url 'http://127.0.0.1:8787/health') {
    Write-Host 'Сервер Кинозала уже работает: http://192.168.11.71:8787' -ForegroundColor Gray
} else {
    Write-Host 'Запускаю API-сервер (порт 8787)...'
    $env:LAMPA_API_SOURCE = 'browser'
    $env:KINOZAL_CDP_URL  = 'http://127.0.0.1:9222'
    Start-Process -FilePath 'node' -ArgumentList 'api-server.js' -WorkingDirectory $dir -WindowStyle Minimized
    $ok = $false
    foreach ($i in 1..15) {
        Start-Sleep -Seconds 1
        if (Test-Url 'http://127.0.0.1:8787/health') { $ok = $true; break }
    }
    if ($ok) { Write-Host 'Сервер Кинозала запущен: http://192.168.11.71:8787' -ForegroundColor Green }
    else { Write-Host 'Сервер не поднялся за 15 секунд — посмотри окно node в панели задач.' -ForegroundColor Red }
}

Write-Host ''
Write-Host 'Теперь открой в LAMPA раздел «Кинозал». Первая загрузка топа может занять до минуты.'
Start-Sleep -Seconds 5
