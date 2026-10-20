@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-connection.ps1"
if errorlevel 1 echo A kapcsolati adatok beallitasa nem fejezodott be.
pause
