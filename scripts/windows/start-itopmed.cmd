@echo off
rem ITop Med: start in the background (if needed) and open the app window.
cd /d "%~dp0\..\.."
node node_modules\tsx\dist\cli.mjs scripts\app.ts start
if errorlevel 1 pause
