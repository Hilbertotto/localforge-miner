@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-from-windows.ps1"
if errorlevel 1 echo A telepites hibaval leallt.
pause
