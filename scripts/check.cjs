const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'build', 'dist', '.git'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.cjs')) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    else if (file.endsWith('.sh') && process.platform !== 'win32') execFileSync('/bin/sh', ['-n', file], { stdio: 'inherit' });
    else if ((file.endsWith('.zsh') || file.endsWith('.command')) && process.platform === 'darwin') execFileSync('/bin/zsh', ['-n', file], { stdio: 'inherit' });
    else if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
check(root);
if (process.platform === 'win32') {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'check-windows.ps1'), '-Root', root], { stdio: 'inherit', windowsHide: true });
}
console.log('Source syntax and JSON checks passed.');
