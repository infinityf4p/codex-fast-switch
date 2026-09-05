@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" doctor %*
exit /b %errorlevel%
