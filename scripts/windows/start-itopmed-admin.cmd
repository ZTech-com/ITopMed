@echo off
rem ITop Med Boshqaruv: the control panel for SuperAdmin and network admins, in its own window.
cd /d "%~dp0\..\.."
node node_modules\tsx\dist\cli.mjs scripts\app.ts start --admin
if errorlevel 1 pause
