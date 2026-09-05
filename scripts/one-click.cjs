const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function oneClickScript(archive, packageName, command = 'setup') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packageName)) throw new Error('Invalid Windows package name.');
  if (!['setup', 'uninstall'].includes(command)) throw new Error('Invalid Windows one-click command.');
  const hash = createHash('sha256').update(archive).digest('hex');
  const payload = archive.toString('base64').match(/.{1,120}/g)?.join('\n') || '';
  const script = fs.readFileSync(path.join(__dirname, 'windows-standalone.ps1'), 'utf8')
    .replace('__CODEX_FAST_SHA256__', hash)
    .replaceAll('__CODEX_FAST_PACKAGE__', packageName)
    .replace('__CODEX_FAST_COMMAND__', command)
    .replace('__CODEX_FAST_PAYLOAD__', payload);
  const bootstrap = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "CODEX_FAST_SETUP_SELF=%~f0"',
    'set "CODEX_FAST_SETUP_HELP=0"',
    'if not "%~2"=="" goto usage',
    'if "%~1"=="" goto run',
    'if /i "%~1"=="--help" goto help',
    'if /i "%~1"=="/?" goto help',
    ':usage',
    'echo Usage: "%~nx0" [--help]',
    'exit /b 2',
    ':help',
    'set "CODEX_FAST_SETUP_HELP=1"',
    ':run',
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=\'Stop\'; try { $raw=[IO.File]::ReadAllText($env:CODEX_FAST_SETUP_SELF); $marker=[regex]::Match($raw,\'(?m)^# CODEX_FAST_SETUP_SCRIPT\\r?$\'); if (-not $marker.Success) { throw \'Installer script is incomplete.\' }; & ([scriptblock]::Create($raw.Substring($marker.Index+$marker.Length))) } catch { Write-Host $_.Exception.Message; [void](Read-Host \'Press Enter to close\'); exit 1 }"',
    'exit /b %errorlevel%',
    '# CODEX_FAST_SETUP_SCRIPT',
    script,
  ];
  return bootstrap.join('\n').replace(/\r?\n/g, '\r\n');
}

module.exports = { oneClickScript };
