const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('../src/core/archive.cjs');
const { oneClickScript } = require('./one-click.cjs');
require('../src/platforms/windows/platform.cjs').requireWindows();
const { stagePackage } = require('./package-layout.cjs');
const { version } = require('../package.json');
const name = `codex-fast-switch-${version}-windows`;
const { dist, stage } = stagePackage(name, 'win32');
const zip = path.join(dist, `${name}.zip`);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'zip-windows.ps1'),
  '-Source', stage, '-Destination', zip], { stdio: 'inherit', windowsHide: true });
const archive = fs.readFileSync(zip);
const scripts = [['install.cmd', 'setup'], ['uninstall.cmd', 'uninstall']].map(([file, command]) => {
  const target = path.join(dist, file);
  fs.writeFileSync(target, oneClickScript(archive, name, command));
  return target;
});
fs.writeFileSync(path.join(dist, 'SHA256SUMS-windows.txt'), [zip, ...scripts]
  .map(file => `${sha256(fs.readFileSync(file))}  ${path.basename(file)}\n`).join(''));
console.log([zip, ...scripts].join('\n'));
