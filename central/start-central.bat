@echo off
cd /d "%~dp0\.."
set LOCALFORGE_MAIL_MODE=local
node central/server.mjs
pause
