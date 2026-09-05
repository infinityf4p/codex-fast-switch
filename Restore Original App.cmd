@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bin\run.ps1" restore %*
exit /b %errorlevel%
