@echo off
rem ITop Med: stop the background server.
cd /d "%~dp0\..\.."
node node_modules\tsx\dist\cli.mjs scripts\app.ts stop
"%SystemRoot%\System32\timeout.exe" /t 3 /nobreak >nul
