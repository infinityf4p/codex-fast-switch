const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const storage = require('../../../src/platforms/macos/storage.cjs');
const signing = require('../../../src/platforms/macos/signing.cjs');
const tx = require('../../../src/platforms/macos/transaction.cjs');
const platform = require('../../../src/platforms/macos/platform.cjs');
const { cleanupSigningIdentity } = require('../../support/signing-fixtures.cjs');

const original = process.argv[2];
if (!original) throw new Error('Pass the path to an unmodified official Codex app.');
tx.verify(original, true);
const root = fs.mkdtempSync('/private/tmp/codex-fast-storage-app-');
const app = path.join(root, 'Client.app');
const state = path.join(root, 'state');
const keychain = path.join(root, 'dummy.keychain');
const profile = path.join(root, 'profile');
const codexHome = path.join(root, 'codex-home');
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 60000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let keep = false;
let failed = false;

async function main() {
  try {
    run('/bin/cp', ['-cR', original, app]);
    fs.mkdirSync(profile);
    fs.mkdirSync(codexHome);
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'storage-fixture-only' }), { mode: 0o600 });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6-astra"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:1/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n');
    const helper = storage.enable(state, app, { service: 'codex-fast-storage-dummy', account: 'dummy', keychain, allowInteraction: false });
    const seed = path.join(root, 'seed');
    run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security',
      path.join(__dirname, '../../support/storage-client.m'), '-o', seed]);
    assert.equal(JSON.parse(run(seed, ['seed', keychain, path.join(helper.bundle, 'Contents/MacOS/storage-access')],
      { input: crypto.randomBytes(24).toString('hex') })).status, 0);
    await tx.install(app, state);
    const bridgeConfig = path.join(app, 'Contents/Resources/codex-fast-storage.plist');
    run('/usr/bin/plutil', ['-replace', 'denyOtherKeychainReads', '-bool', 'YES', bridgeConfig]);
    signing.sign(app, state, { entitlements: path.join(__dirname, '../../../src/platforms/macos/local-entitlements.plist') });
    tx.verify(app);
    const env = { HOME: os.homedir(), USER: os.userInfo().username, LOGNAME: os.userInfo().username,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir(), CODEX_HOME: codexHome,
      OPENAI_API_KEY: 'storage-fixture-only' };
    const log = fs.openSync(path.join(root, 'startup.log'), 'w', 0o600);
    child = spawn(platform.binaryPath(app), [`--user-data-dir=${profile}`, '--disable-background-networking',
      '--disable-component-update', '--no-first-run'], { env, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    let access;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(state, 'storage-status.json'))) access = tx.readJson(path.join(state, 'storage-status.json'));
      if (access?.reason === 'read' || child.exitCode !== null || child.signalCode) break;
      await wait(200);
    }
    assert.equal(access?.reason, 'read', `The app did not read through the helper: ${JSON.stringify(access)}. Logs: ${root}`);
    assert.equal(access.status, 0);
    assert.equal(access.pid, child.pid);
    const readyDeadline = Date.now() + 30000;
    while (Date.now() < readyDeadline && !fs.readFileSync(path.join(root, 'startup.log'), 'utf8').includes('Codex CLI initialized')) await wait(200);
    await wait(5000);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    const startup = fs.readFileSync(path.join(root, 'startup.log'), 'utf8');
    assert.equal(startup.includes('Codex CLI initialized'), true, 'The isolated app server did not initialize.');
    assert.equal(startup.includes('Desktop bootstrap failed'), false, 'The isolated app bootstrap failed.');
    console.log(JSON.stringify({ passed: true, app: tx.version(app), patchRevision: tx.marker(app).revision, bridgeLoaded: true,
      storageReadThroughHelper: true, realKeychainItemsAccessed: false, nativeSignatureVerified: true }, null, 2));
  } catch (error) {
    failed = true;
    console.error(`Isolated test artifacts: ${root}`);
    throw error;
  } finally {
    if (child && child.exitCode === null && !child.signalCode) {
      platform.requestQuit(app);
      const deadline = Date.now() + 10000;
      while (child.exitCode === null && !child.signalCode && Date.now() < deadline) await wait(100);
      if (child.exitCode === null && !child.signalCode) {
        keep = true;
        console.error(`The isolated app is still running; close ${app} before removing ${root}.`);
        child.unref();
      }
    }
    if (!keep) {
      if (fs.existsSync(keychain) || fs.existsSync(keychain + '-db')) run('/usr/bin/security', ['delete-keychain', keychain]);
      cleanupSigningIdentity(state);
      if (!failed) fs.rmSync(root, { recursive: true, force: true });
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
