@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-lan.ps1"
if errorlevel 1 goto end
call "%~dp0web-login.bat"
:end
pause
