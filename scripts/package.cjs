const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('../lib/archive.cjs');
const { requireMac } = require('../lib/platform.cjs');
requireMac();
const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const name = `codex-fast-switch-${version}-macos-universal`;
const dist = path.join(root, 'dist');
const stage = path.join(dist, name);
if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true });
fs.mkdirSync(stage, { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, 'build.cjs')], { stdio: 'inherit' });
const files = ['automatic.cjs', 'cli.cjs', 'lib', 'bin', 'docs', 'scripts', 'test', 'node_modules', 'package.json',
  'package-lock.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md',
  'Apply Once.command', 'Enable Automatic Fast.command', 'Disable Automatic Fast.command', 'Restore Original App.command', 'Check Status.command'];
for (const file of files) fs.cpSync(path.join(root, file), path.join(stage, file), { recursive: true, verbatimSymlinks: true });
const zip = path.join(dist, `${name}.zip`);
if (fs.existsSync(zip)) fs.rmSync(zip);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', stage, zip]);
execFileSync('/usr/bin/unzip', ['-tq', zip], { stdio: 'inherit' });
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${sha256(fs.readFileSync(zip))}  ${path.basename(zip)}\n`);
console.log(zip);
