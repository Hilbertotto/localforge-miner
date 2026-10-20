@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web-remote.ps1" -Mode install
if errorlevel 1 echo Hiba tortent, masold be a kimenetet a chatbe.
pause
