const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requirementFor, readIdentity } = require('../../src/platforms/macos/signing.cjs');

test('local identity requirement binds both the certificate and exact app identifier', () => {
  const certificate = 'abcde'.repeat(8);
  assert.equal(requirementFor('com.openai.codex', certificate),
    `identifier "com.openai.codex" and certificate leaf = H"${certificate}"`);
  for (const identifier of ['', 'com.openai.codex" or true', '../codex']) {
    assert.throws(() => requirementFor(identifier, certificate), /Invalid/);
  }
  for (const fingerprint of ['', '-'.repeat(40), 'a'.repeat(39), 'a'.repeat(41)]) {
    assert.throws(() => requirementFor('com.openai.codex', fingerprint), /Invalid/);
  }
});

test('an incomplete or substituted signing identity is refused without creating replacement files', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-signing-record-'));
  const directory = path.join(root, 'signing');
  fs.mkdirSync(directory, { mode: 0o700 });
  try {
    fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({ schema: 1 }), { mode: 0o600 });
    assert.throws(() => readIdentity(root), /ENOENT/);
    assert.deepEqual(fs.readdirSync(directory), ['identity.json']);
    for (const file of ['certificate.der', 'password', 'identity.keychain-db']) {
      fs.writeFileSync(path.join(directory, file), 'substituted', { mode: 0o600 });
    }
    const before = fs.readdirSync(directory).map(file => [file, fs.readFileSync(path.join(directory, file), 'utf8')]);
    assert.throws(() => readIdentity(root), /does not match/);
    assert.deepEqual(fs.readdirSync(directory).map(file => [file, fs.readFileSync(path.join(directory, file), 'utf8')]), before);
    fs.chmodSync(path.join(directory, 'password'), 0o644);
    assert.throws(() => readIdentity(root), /private/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
