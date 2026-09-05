const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('../lib/archive.cjs');
const { oneClickScript } = require('./one-click.cjs');
require('../windows/platform.cjs').requireWindows();
const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const name = `codex-fast-switch-${version}-windows`;
const dist = path.join(root, 'dist');
const stage = path.join(dist, name);
fs.mkdirSync(stage, { recursive: true });
for (const item of ['cli.cjs', 'automatic.cjs', 'watch.cjs', 'install.sh', 'lib', 'windows', 'bin', 'docs', 'scripts', 'test', 'node_modules', 'package.json', 'package-lock.json',
  'README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CHANGELOG.md',
  ...fs.readdirSync(root).filter(file => file.endsWith('.cmd'))]) {
  fs.cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
}
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
