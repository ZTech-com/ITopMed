@echo off
rem ITop Med: start the server in the background without opening a window (used by autostart).
cd /d "%~dp0\..\.."
node node_modules\tsx\dist\cli.mjs scripts\app.ts start --no-window
