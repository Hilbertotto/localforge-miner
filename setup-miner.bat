@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-miner.ps1" %*
if errorlevel 1 echo A telepites nem fejezodott be. A hibauzenet alapjan ujraprobalhato.
pause
