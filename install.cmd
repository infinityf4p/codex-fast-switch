@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launchers\windows\run.ps1" setup %*
exit /b %errorlevel%
