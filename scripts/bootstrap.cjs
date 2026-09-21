const fs = require('node:fs');
const path = require('node:path');
const { wrapPowerShell } = require('./one-click.cjs');

function windowsBootstrap(command) {
  if (!['setup', 'uninstall'].includes(command)) throw new Error('Invalid bootstrap command.');
  return wrapPowerShell(fs.readFileSync(path.join(__dirname, 'windows-bootstrap.ps1'), 'utf8')
    .replace('__CODEX_FAST_COMMAND__', command));
}
function generate({ check = false } = {}) {
  for (const [file, command] of [['install.cmd', 'setup'], ['uninstall.cmd', 'uninstall']]) {
    const target = path.join(__dirname, '..', file), bytes = windowsBootstrap(command);
    if (check) {
      if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== bytes.replace(/\r\n/g, '\n')) {
        throw new Error(`${file} is outdated. Run node scripts/bootstrap.cjs.`);
      }
    } else fs.writeFileSync(target, bytes);
  }
}
if (require.main === module) generate({ check: process.argv.includes('--check') });
module.exports = { windowsBootstrap, generate };
