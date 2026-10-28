@echo off
setlocal
cd /d "%~dp0"
set "LAMPA_API_SOURCE=mock"
echo Starting Lampa Kinozal API test server on http://192.168.11.71:8787
node ".\lampa-kinozal\api-server.js"
echo.
echo Server stopped. Press any key to close this window.
pause >nul
