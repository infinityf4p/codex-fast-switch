const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { manifest } = require('../../src/platforms/windows/identity.cjs');

const windows = { skip: process.platform !== 'win32' };
const ids = ['1-11111111-1111-1111-1111-111111111111', '2-22222222-2222-2222-2222-222222222222'];

function fixture(t) {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-identity-removal-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 }));
  const state = path.join(temporary, 'selected state');
  function generation(base, id) {
    const root = path.join(base, 'versions', id);
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'record.json'), JSON.stringify({ patchId: 'codex-fast-switch-windows-v1', id, app: path.join(root, 'app') }));
    fs.writeFileSync(path.join(root, 'AppxManifest.xml'), manifest('x64'));
    return root;
  }
  const roots = ids.map(id => generation(state, id));
  const other = generation(path.join(temporary, 'another state'), ids[0]);
  const pkg = (root, extra = {}) => ({ Name: 'CodexFast.Switch', Publisher: 'CN=CodexFastLocal',
    InstallLocation: root, PackageFullName: `package-${path.basename(path.dirname(path.dirname(root)))}-${path.basename(root)}`,
    PackageFamilyName: 'CodexFast.Switch_fixture', Status: 'Ok', Version: '1.0.0.0', ...extra });
  let sequence = 0;
  function run({ action = 'remove-identity', payload = { state, roots }, packages = [], ...options } = {}) {
    const configuration = path.join(temporary, `fixture-${sequence}.json`);
    const trace = path.join(temporary, `trace-${sequence++}.json`);
    fs.writeFileSync(configuration, JSON.stringify({ action, payload, packages, ...options }));
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, '../support/windows-identity-removal.ps1'),
        '-Implementation', path.join(__dirname, '../../src/platforms/windows/native.ps1'),
        '-Configuration', configuration, '-Trace', trace],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.ok(result.stdout.trim(), result.stderr);
    return { status: result.status, result: JSON.parse(result.stdout.trim()), ...JSON.parse(fs.readFileSync(trace, 'utf8')) };
  }
  return { temporary, state, roots, other, pkg, run };
}

test('native removal matches the exact generation, identity and publisher for the current user', windows, t => {
  const f = fixture(t);
  const owned = f.pkg(f.roots[0].toUpperCase(), { Name: 'CODEXFAST.SWITCH', Publisher: 'cn=codexfastlocal' });
  const unrelated = [f.pkg(f.other), f.pkg(`${f.roots[0]}-suffix`),
    f.pkg(f.roots[0], { Name: 'OpenAI.Codex', PackageFullName: 'official-package' }),
    f.pkg(f.roots[0], { Publisher: 'CN=AnotherPublisher', PackageFullName: 'different-publisher' })];
  const result = f.run({ packages: [owned, ...unrelated], payload: { state: f.state.toUpperCase(), roots: [f.roots[0], f.roots[0].toUpperCase()] } });
  assert.equal(result.status, 0, JSON.stringify(result.result));
  assert.deepEqual(result.result, { status: 'removed', removed: [owned.PackageFullName] });
  assert.deepEqual(result.calls.filter(call => call.action === 'remove').map(call => call.package), [owned.PackageFullName]);
  assert.deepEqual(result.packages, unrelated);
  assert.equal(result.calls.filter(call => call.action === 'get').length, 2);
  assert.ok(result.calls.every(call => call.errorAction === 'Stop'));
});

test('missing registration and registration belonging to another state are idempotent no-ops', windows, t => {
  const f = fixture(t);
  for (const [packages, roots] of [[[], f.roots], [[f.pkg(f.other)], f.roots], [[f.pkg(f.roots[0])], []]]) {
    const result = f.run({ packages, payload: { state: f.state, roots } });
    assert.equal(result.status, 0, JSON.stringify(result.result));
    assert.deepEqual(result.result, { status: 'not-registered', removed: [] });
    assert.equal(result.calls.some(call => call.action === 'remove'), false);
    assert.deepEqual(result.packages, packages);
  }
});

test('native removal fails visibly on enumeration errors, removal errors or registrations left behind', windows, t => {
  const f = fixture(t);
  for (const [options, expected] of [
    [{ failGetAt: [1] }, /enumeration failed/],
    [{ failRemove: true }, /removal failed/],
    [{ failGetAt: [2] }, /enumeration failed/],
    [{ retainAfterRemove: true }, /still registered/],
  ]) {
    const result = f.run({ packages: [f.pkg(f.roots[0])], ...options });
    assert.equal(result.status, 1);
    assert.equal(result.result.error.code, 'WINDOWS_NATIVE_FAILED');
    assert.match(result.result.error.message, expected);
  }
});

test('invalid or redirected removal roots are rejected before package enumeration', windows, t => {
  const f = fixture(t);
  for (const roots of [[f.other], [path.join(f.roots[0], 'app')], [f.state], ['relative/versions/' + ids[0]]]) {
    const result = f.run({ payload: { state: f.state, roots } });
    assert.equal(result.status, 1);
    assert.equal(result.calls.length, 0);
  }
  const redirected = path.join(f.state, 'versions', '3-33333333-3333-3333-3333-333333333333');
  fs.symlinkSync(f.other, redirected, 'junction');
  const result = f.run({ payload: { state: f.state, roots: [redirected] } });
  assert.equal(result.status, 1);
  assert.match(result.result.error.message, /redirected/);
  assert.equal(result.calls.length, 0);
});

test('identity registration refuses another state, invalid ownership records and running old apps', windows, t => {
  const f = fixture(t);
  const payload = { name: 'CodexFast.Switch', version: '1.0.0.0', root: f.roots[1], refresh: true };
  const redirected = path.join(f.state, 'versions', '3-33333333-3333-3333-3333-333333333333');
  fs.symlinkSync(f.other, redirected, 'junction');
  const cases = [
    { packages: [f.pkg(f.other)] },
    { packages: [f.pkg(redirected)] },
    { packages: [f.pkg(f.roots[0], { Publisher: 'CN=AnotherPublisher' })] },
    { packages: [f.pkg(f.roots[0])], processes: [{ ProcessName: 'ChatGPT', Path: path.join(f.roots[0], 'app', 'ChatGPT.exe') }] },
  ];
  for (const options of cases) {
    const result = f.run({ action: 'identity', payload, ...options });
    assert.equal(result.status, 1);
    assert.equal(result.calls.some(call => ['add', 'remove'].includes(call.action)), false);
  }
  fs.writeFileSync(path.join(f.roots[0], 'record.json'), JSON.stringify({ patchId: 'other-tool', id: ids[0], app: path.join(f.roots[0], 'app') }));
  const invalid = f.run({ action: 'identity', payload, packages: [f.pkg(f.roots[0])] });
  assert.equal(invalid.status, 1);
  assert.match(invalid.result.error.message, /record does not belong/);
  assert.equal(invalid.calls.some(call => ['add', 'remove'].includes(call.action)), false);
});

test('identity registration restores the previous generation after new registration fails', windows, t => {
  const f = fixture(t);
  const result = f.run({ action: 'identity', payload: { name: 'CodexFast.Switch', version: '1.0.0.0', root: f.roots[1] },
    packages: [f.pkg(f.roots[0])], failAddAt: [1] });
  assert.equal(result.status, 1);
  assert.match(result.result.error.message, /registration failed #1/);
  assert.doesNotMatch(result.result.error.message, /recovery failed/);
  assert.deepEqual(result.calls.filter(call => call.action === 'add').map(call => path.dirname(call.manifest)), [f.roots[1], f.roots[0]]);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].InstallLocation, f.roots[0]);
});

test('failed registration recovery retains the original failure and reports the recovery failure', windows, t => {
  const f = fixture(t);
  const result = f.run({ action: 'identity', payload: { name: 'CodexFast.Switch', version: '1.0.0.0', root: f.roots[1] },
    packages: [f.pkg(f.roots[0])], failAddAt: [1, 2] });
  assert.equal(result.status, 1);
  assert.match(result.result.error.message, /registration failed #1/);
  assert.match(result.result.error.message, /Registration recovery failed:.*registration failed #2/);
});

test('same-generation identity refresh never removes the registration', windows, t => {
  const f = fixture(t);
  const result = f.run({ action: 'identity', payload: { name: 'CodexFast.Switch', version: '1.0.0.0', root: f.roots[0], refresh: true },
    packages: [f.pkg(f.roots[0])] });
  assert.equal(result.status, 0, JSON.stringify(result.result));
  assert.equal(result.result.installLocation, f.roots[0]);
  assert.equal(result.calls.some(call => call.action === 'remove'), false);
  assert.equal(result.calls.filter(call => call.action === 'add').length, 1);
});
