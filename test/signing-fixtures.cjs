const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function cleanupSigningIdentity(state) {
  const keychain = path.join(path.resolve(state), 'signing', 'identity.keychain-db');
  if (!fs.existsSync(keychain)) return false;
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temporaryRoot, fs.realpathSync(keychain));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.split(path.sep)[0].startsWith('codex-') ||
      fs.lstatSync(keychain).isSymbolicLink()) {
    throw new Error('Signing fixture cleanup only accepts an identity inside its own temporary test directory.');
  }
  execFileSync(path.join(__dirname, '../lib/signing-helper'), ['delete', keychain], {
    input: '{}', encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return true;
}

module.exports = { cleanupSigningIdentity };
