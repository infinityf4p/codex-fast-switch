const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const signing = require('../../../src/platforms/macos/signing.cjs');
const { cleanupSigningIdentity } = require('../../support/signing-fixtures.cjs');

const run = (file, args, options = {}) => execFileSync(file, args, {
  encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], ...options,
});

function signature(binary) {
  const { spawnSync } = require('node:child_process');
  const display = args => {
    const child = spawnSync('/usr/bin/codesign', args.concat(binary), { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout + child.stderr;
  };
  return {
    cdhash: display(['--display', '--verbose=4']).match(/^CDHash=(\w+)$/m)?.[1],
    requirement: display(['--display', '--requirements', '-']).match(/^designated => (.+)$/m)?.[1],
  };
}

async function main() {
  assert.equal(process.platform, 'darwin', 'The signing integration test requires macOS.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-signing-'));
  const keychain = path.join(root, 'acl-test.keychain');
  const state = path.join(root, 'identity-a');
  const otherState = path.join(root, 'identity-c');
  const missingState = path.join(root, 'identity-missing');
  const expectedState = path.join(root, 'identity-expected');
  const binaries = ['a', 'b', 'c'].map(name => path.join(root, `probe-${name}`));
  const helper = path.join(root, 'probe-admin');
  const settings = {
    password: crypto.randomBytes(24).toString('base64url'),
    service: 'io.github.infinityf4p.codex-fast-switch.signing-test',
    account: crypto.randomUUID(), value: crypto.randomBytes(32).toString('hex'),
  };
  const probe = (binary, command) => JSON.parse(run(binary, [command, keychain], { input: JSON.stringify(settings) }));
  const compile = (binary, build) => run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-Wno-deprecated-declarations',
    '-framework', 'Foundation', '-framework', 'Security', `-DPROBE_BUILD=${build}`,
    path.join(__dirname, '../../support/signing-probe.m'), '-o', binary]);
  const checks = [];
  let before;
  try {
    compile(helper, 0);
    before = JSON.parse(run(helper, ['snapshot']));
    for (const [index, binary] of binaries.entries()) compile(binary, index + 1);
    const identity = await signing.ensureIdentity(state);
    const repeated = await signing.ensureIdentity(state);
    assert.equal(repeated.certificateSha256, identity.certificateSha256);
    assert.equal(repeated.certificateSha1, identity.certificateSha1);
    checks.push('Repeated setup preserves the signing certificate');
    const unsigned = fs.readFileSync(binaries[0]);
    assert.throws(() => signing.sign(binaries[0], state, {
      identifier: 'io.github.infinityf4p.codex-fast-switch.signing-test', options: false,
      expectedCertificateSha256: '0'.repeat(64),
    }), /differs from/);
    assert.deepEqual(fs.readFileSync(binaries[0]), unsigned);
    checks.push('A changed certificate stops signing before modifying the target');
    for (const [index, binary] of binaries.entries()) {
      await signing.sign(binary, index === 2 ? otherState : state, {
        identifier: 'io.github.infinityf4p.codex-fast-switch.signing-test', options: false,
        expectedCertificateSha256: index === 2 ? undefined : identity.certificateSha256,
      });
    }
    const [first, second, different] = binaries.map(signature);
    assert.ok(first.cdhash && second.cdhash && different.cdhash);
    assert.notEqual(first.cdhash, second.cdhash);
    assert.ok(first.requirement);
    assert.equal(first.requirement, second.requirement);
    assert.notEqual(first.requirement, different.requirement);
    checks.push('Different builds share the certificate-bound requirement while their CDHashes differ');
    assert.equal(probe(binaries[0], 'seed').status, 0);
    for (const index of [0, 1]) {
      const output = probe(binaries[index], 'read');
      assert.equal(output.build, index + 1);
      assert.equal(output.status, 0);
      assert.equal(output.matches, true);
    }
    checks.push('Both builds decrypt the same private test item with Keychain UI prohibited');
    const denied = probe(binaries[2], 'read');
    assert.equal(denied.build, 3);
    assert.ok([-25308, -25293].includes(denied.status), `Expected authorization rejection, received ${denied.status}`);
    assert.equal(denied.matches, false);
    checks.push('Another certificate with the same identifier cannot decrypt the item');
    const reread = probe(binaries[1], 'read');
    assert.equal(reread.status, 0);
    assert.equal(reread.matches, true);
    const pin = fs.readFileSync(path.join(state, 'signing-identity.json'));
    fs.mkdirSync(missingState, { mode: 0o700 });
    fs.writeFileSync(path.join(missingState, 'signing-identity.json'), pin, { mode: 0o600 });
    assert.throws(() => signing.ensureIdentity(missingState), /identity is missing.*no replacement identity was generated/);
    assert.deepEqual(fs.readdirSync(missingState), ['signing-identity.json']);
    assert.deepEqual(fs.readFileSync(path.join(missingState, 'signing-identity.json')), pin);
    checks.push('A saved certificate pin prevents silent replacement when the entire identity directory is missing');
    assert.throws(() => signing.ensureIdentity(expectedState, { expectedCertificateSha256: identity.certificateSha256 }),
      /identity is missing.*no replacement identity was generated/);
    assert.deepEqual(fs.readdirSync(expectedState), []);
    checks.push('An expected certificate prevents generation of replacement identity files');
    const during = JSON.parse(run(helper, ['snapshot']));
    const canonical = file => fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
    assert.equal(during.defaultKeychain, before.defaultKeychain);
    const owned = [
      signing.readIdentity(state).keychain, signing.readIdentity(otherState).keychain,
    ].map(canonical);
    const registered = during.searchList.map(canonical);
    assert.deepEqual(registered.filter(file => owned.includes(file)), owned);
    assert.deepEqual(registered.filter(file => !owned.includes(file)), before.searchList.map(canonical));
    checks.push('Signing only appends its two private Keychains and preserves the default Keychain');
  } finally {
    const failures = [];
    for (const identityState of [state, otherState, missingState, expectedState]) {
      try { cleanupSigningIdentity(identityState); } catch (error) { failures.push(error); }
    }
    try {
      if (fs.existsSync(keychain) || fs.existsSync(`${keychain}-db`)) probe(helper, 'delete');
    } catch (error) { failures.push(error); }
    try {
      if (before) assert.deepEqual(JSON.parse(run(helper, ['snapshot'])), before);
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, `Signing test cleanup failed; recovery files remain at ${root}`);
    fs.rmSync(root, { recursive: true, force: true });
  }
  checks.push('Cleanup removes only its private Keychains and restores the exact original search list');
  console.log(JSON.stringify({ testedAt: new Date().toISOString(), passed: true, checks,
    productionAppModified: false, userKeychainItemsAccessed: false }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
