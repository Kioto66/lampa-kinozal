# Миграция LAMPA на Kioto miniPC — документ передачи (31.10.2026)

Новая сессия: прочитай AGENTS.md (секция «Kioto miniPC») и этот файл — здесь всё состояние.

## Сервер
- **Kioto miniPC**: `kioto@192.168.11.144`, Ubuntu 22.04, XFCE через xrdp.
- SSH по ключу без пароля; sudo NOPASSWD (`/etc/sudoers.d/kioto-nopasswd`).
- **Правило пользователя**: любые действия на miniPC — только через видимое окно консоли, никаких скрытых окон. Видимая консоль развёрнута: окно «Kioto miniPC - VISIBLE CONSOLE» (скрипт `C:\Users\Kioto\AppData\Local\Temp\opencode\minipc-console.ps1`). Механика: пишешь команду в `%TEMP%\opencode\minipc-cmd.txt` (перед этим сбросить `minipc-out.log` в `--- pending ---`), ждёшь маркер `<<<END>>>` в `minipc-out.log`, читаешь результат. Внутри кавычки экранируй: без одиночных кавычек внутри команды, без бэктиков.

## Что уже сделано и работает на сервере
- VPN/прокси удалены полностью (sing-box, v2rayA, OpenVPN, WireGuard), `/etc/environment` чист, интернет прямой. Бэкап удалённого: `/home/kioto/vpn-backup-20261031.tar.gz`.
- Wi-Fi Netcraze8856 работает (polkit-правила `/etc/polkit-1/localauthority/50-local.d/10-kioto-network.pkla` + `/etc/polkit-1/rules.d/10-kioto-network.rules` — разрешают kioto управлять NetworkManager из RDP).
- Gemini CLI удалён (npm @google/gemini-cli, `~/.gemini`); **OpenCode v2.2.5** установлен (`/home/kioto/.opencode/bin/opencode`, есть бесплатные модели).
- Node.js: nvm **v24.13.0** → `/home/kioto/.nvm/versions/node/v24.13.0/bin/node`.
- **Проектный Chrome запущен вручную в RDP-сессии** (дисплей `:10`): `/opt/google/chrome/chrome --remote-debugging-port=9222 --user-data-dir=/home/kioto/.kinozal-manual-profile` — окно видит пользователь по RDP, CDP :9222 отвечает. Профиль СВЕЖИЙ — логинов в kinozal.me/rutracker.org ещё нет.
- Browsec VPN в Chrome: переустановлен после случайного удаления, все политики Chrome сняты (`/etc/opt/chrome/policies/managed` пуст).

## Пакет миграции (перенесён на сервер 31.10.2026, развёрнут и работает)
`C:\Users\Kioto\AppData\Local\Temp\opencode\lampa-migrate\`, 14 файлов (копия = /home/kioto/lampa/):
- Скопированы с Windows (`D:\Projects\Assistant\ТВ`): `api-server.js`, `mock-results.json`, `package.json` (зависимость: playwright-core 1.55.0), `package-lock.json`, `plugin.js`, `nm.js`, `rt.js`, `pl.js`.
- Новые (Linux-версии): `lampa-control.sh` (start|stop|restart|chrome|status|logs — аналог kinozal-control.ps1), `lampa-tray.py` (трей-панель, аналог kinozal-tray.exe: статус каждые 5 сек, меню «Запустить всё / Остановить всё / Открыть окно Chrome / Выход»), `lampa-chrome-autostart.sh` (Chrome поднимается ТОЛЬКО в xrdp-сессии — проверка по pgrep Xorg xrdp), `lampa-tray.desktop`, `lampa-chrome.desktop` (XDG autostart), `lampa-api.service` (systemd system-сервис, User=kioto, `LAMPA_API_SOURCE=browser`, `KINOZAL_CDP_URL=http://127.0.0.1:9222`, node из nvm абсолютным путём).

## Что осталось (порядок работ)

### Выполнено 31.10.2026 (шаги 1–7)
1. ✅ Файлы перенесены в `/home/kioto/lampa/` — через видимую консоль чанками base64 (scp-обёртки нет; скрипт `push-lampa.ps1` в `%TEMP%\opencode\`). Размеры совпали байт-в-байт.
2. ✅ CRLF→LF (sed), chmod +x *.sh.
3. ✅ `npm install` (playwright-core, nvm node v24.13.0).
4. ✅ `lampa-api.service` установлен, `systemctl enable --now` — **активен**; прицепился к проектному Chrome CDP :9222.
5. ✅ `lampa-tray.desktop`, `lampa-chrome.desktop` → `~/.config/autostart/`.
6. ✅ `python3-gi` + `gir1.2-ayatanaappindicator3-0.1` установлены.
7. ✅ Проверки: `/health` → ok (mode browser); `lampa-control.sh status` → API + Chrome работают; `/nm/v1/list` отдаёт реальные данные; **кинозал-поиск тоже работает анонимно** (Cloudflare проходит браузером); трей запущен вручную (pid жив, после правки require_version 0.3→0.1 — в Ubuntu 22.04 GIR-версия 0.1).
   - **Бонус-фикс**: `sudo ufw allow 8787/tcp comment LAMPA-API` — ufw резал порт, из локалки было недоступно. Теперь `http://192.168.11.144:8787/health` отвечает с Windows.

### Осталось (шаги 8–9)
8. **ТВ**: в LAMPA-настройках каждого из 4 плагинов поле «URL локального API» → `http://192.168.11.144:8787` (действие пользователя на ТВ). Альтернатива: поменять `DEFAULT_PROXY_URL` в `D:\Projects\Assistant\ТВ\*.js` (сейчас `192.168.11.71`) и запушить на GitHub Pages — **только по явной команде пользователя** (деплой).
9. Пользователь должен залогиниться на kinozal.me и rutracker.org в проектном Chrome на сервере + пройти Cloudflare вручную при первом заходе (как на Windows). Кинозал-поиск уже работает без логина, RT без логина работать не будет.

## Риски / примечания
- Chrome живёт в RDP-сессии: **не выходить из сессии** (просто отключаться от RDP) — при logout Chrome умрёт и поднимется только при следующем входе.
- Дисплей RDP-сессии меняется (сейчас `:10`) — `lampa-control.sh` определяет его сам (pgrep Xorg c `xrdp/xorg.conf`).
- Windows api-server (192.168.11.71:8787) продолжает работать — ТВ смотрит туда, пока не переключат URL.
- В `lampa-control.sh stop` pkill по `kinozal-manual-profile` убивает Chrome проекта — не задевает личный браузер пользователя.
