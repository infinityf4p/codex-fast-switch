const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const storage = require('../../../src/platforms/macos/storage.cjs');
const signing = require('../../../src/platforms/macos/signing.cjs');
const { cleanupSigningIdentity } = require('../../support/signing-fixtures.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-storage-'));
const app = path.join(root, 'Client.app');
const state = path.join(root, 'state');
const otherState = path.join(root, 'other-state');
const keychain = path.join(root, 'dummy.keychain');
const password = crypto.randomBytes(24).toString('hex');
const checks = [];
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'], ...options });
const writePlist = (file, value) => { fs.writeFileSync(file, JSON.stringify(value)); run('/usr/bin/plutil', ['-convert', 'xml1', file]); };
const binary = path.join(app, 'Contents/MacOS/client');
const signature = file => {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', file], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  return result.stderr.match(/^CDHash=(\w+)$/m)[1];
};
function makeClient(build) {
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents/Resources'));
  writePlist(path.join(app, 'Contents/Info.plist'), { CFBundleIdentifier: 'com.openai.codex', CFBundleExecutable: 'client',
    CFBundleName: 'Storage Test', CFBundlePackageType: 'APPL', CFBundleVersion: String(build) });
  run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security',
    `-DSTORAGE_TEST_BUILD=${build}`, '-Wl,-headerpad_max_install_names', path.join(__dirname, '../../support/storage-client.m'), '-o', binary]);
}
function signClient(identity = state, identifier = 'com.openai.codex') {
  signing.sign(app, identity, { identifier, entitlements: path.join(__dirname, '../../../src/platforms/macos/local-entitlements.plist') });
}
const invoke = (...args) => JSON.parse(run(binary, args));

try {
  makeClient(1);
  const record = storage.enable(state, app, { service: 'codex-fast-storage-dummy', account: 'dummy', keychain, allowInteraction: false });
  const helper = path.join(record.bundle, 'Contents/MacOS/storage-access');
  assert.equal(JSON.parse(run(binary, ['seed', keychain, helper], { input: password })).status, 0);
  const helperHash = signature(record.bundle);
  storage.copyBridge(app, app, state);
  signClient();
  const firstHash = signature(app);
  const first = invoke();
  assert.equal(first.status, 0);
  assert.equal(first.matches, true);
  assert.equal(invoke('data-only').matches, true);
  checks.push('Both dictionary and data-only reads use the fixed helper with Keychain UI disabled');
  assert.equal(invoke('unrelated').status, -25300);
  checks.push('Unrelated Keychain lookups retain their original behavior');
  makeClient(2);
  assert.deepEqual(storage.enable(state, app), record);
  storage.copyBridge(app, app, state);
  signClient();
  assert.notEqual(signature(app), firstHash);
  assert.equal(signature(record.bundle), helperHash);
  const second = invoke();
  assert.equal(second.build, 2);
  assert.equal(second.status, 0);
  assert.equal(second.matches, true);
  checks.push('An updated client with a different CDHash reuses the unchanged helper and authorization');
  const copied = path.join(root, 'Other.app');
  fs.cpSync(app, copied, { recursive: true });
  assert.equal(JSON.parse(run(path.join(copied, 'Contents/MacOS/client'), [])).status, -25293);
  checks.push('A correctly signed client copied to a different path is rejected');
  signClient(state, 'io.github.infinityf4p.codex-fast-switch.wrong-client');
  assert.equal(invoke().status, -25293);
  signClient(otherState);
  assert.equal(invoke().status, -25293);
  signClient();
  checks.push('Wrong application identifiers and different signing certificates are rejected');
  const configFile = path.join(record.bundle, 'Contents/Resources/storage-access.plist');
  const config = fs.readFileSync(configFile);
  fs.appendFileSync(configFile, '\n');
  assert.equal(invoke().status, -25293);
  fs.writeFileSync(configFile, config);
  assert.equal(invoke().matches, true);
  checks.push('A modified helper is rejected before it can read a Keychain item');
  fs.renameSync(record.bundle, record.bundle + '.missing');
  assert.equal(invoke().status, -25293);
  fs.renameSync(record.bundle + '.missing', record.bundle);
  checks.push('A missing helper fails without falling back to reading or recreating the storage key');
  console.log(JSON.stringify({ passed: true, checks, realKeychainItemsAccessed: false }, null, 2));
} finally {
  if (fs.existsSync(keychain) || fs.existsSync(keychain + '-db')) run('/usr/bin/security', ['delete-keychain', keychain]);
  cleanupSigningIdentity(state);
  cleanupSigningIdentity(otherState);
  fs.rmSync(root, { recursive: true, force: true });
}
