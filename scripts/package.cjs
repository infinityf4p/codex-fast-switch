const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('../src/core/archive.cjs');
if (process.platform === 'win32') {
  require('./package-windows.cjs');
  process.exit(0);
}
require('../src/platforms/macos/platform.cjs').requireMac();
const { stagePackage } = require('./package-layout.cjs');
const { version } = require('../package.json');
const name = `codex-fast-switch-${version}-macos-universal`;
execFileSync(process.execPath, [path.join(__dirname, 'build.cjs')], { stdio: 'inherit' });
const { dist, stage } = stagePackage(name, 'darwin');
const zip = path.join(dist, `${name}.zip`);
if (fs.existsSync(zip)) fs.rmSync(zip);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', stage, zip]);
execFileSync('/usr/bin/unzip', ['-tq', zip], { stdio: 'inherit' });
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${sha256(fs.readFileSync(zip))}  ${path.basename(zip)}\n`);
console.log(zip);
