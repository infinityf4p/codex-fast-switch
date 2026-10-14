const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { version, release, PRODUCT, IDENTITY } = require('../../src/platforms/windows/official-release.cjs');
const official = require('../../src/platforms/windows/official-update.cjs');
const store = require('../../src/platforms/windows/store.cjs');
const updates = require('../../src/platforms/windows/updates.cjs');
const cleanup = require('../../src/platforms/windows/cleanup.cjs');
const feed = { schemaVersion: 1, storeProductId: PRODUCT, packageIdentity: IDENTITY, buildVersion: '26.1007.9446.0' };

test('official releases derive the same architecture-specific HTTPS MSIX URL as the native updater', () => {
  for (const arch of ['x64', 'arm64']) {
    assert.deepEqual(release(feed, arch), { version: feed.buildVersion, arch,
      url: `https://persistent.oaistatic.com/codex-app-prod/releases/${feed.buildVersion}/ChatGPT-${arch}.msix`,
      sha256: null, length: null });
  }
  assert.ok(version('26.1007.9446.0') > version('26.915.4065.0'));
  const selected = release({ ...feed, packages: [{ arch: 'arm64' }, { arch: 'x64', length: 123, sha256: 'A'.repeat(64) }] }, 'x64');
  assert.equal(selected.length, 123);
  assert.equal(selected.sha256, 'a'.repeat(64));
});

test('official releases reject changed identities, ambiguous architectures and external or downgraded transport', () => {
  for (const change of [
    { schemaVersion: 2 }, { storeProductId: 'other' }, { packageIdentity: 'other' }, { packagePublisher: 'other' },
    { buildVersion: '../escape' }, { buildVersion: '26.1.2.65536' }, { packages: [{ arch: 'arm64' }] },
    { packages: [{ arch: 'x64' }, { arch: 'x64' }] }, { packages: [null] }, { length: -1 }, { length: 9 * 1024 ** 3 },
    { sha256: 'bad' }, { packageUrl: 'http://persistent.oaistatic.com/codex-app-prod/releases/test.msix' },
    { packageUrl: 'https://example.com/test.msix' }, { packageUrl: 'https://persistent.oaistatic.com/other/test.msix' },
    { packageUrl: 'https://user@persistent.oaistatic.com/codex-app-prod/releases/test.msix' },
  ]) assert.throws(() => release({ ...feed, ...change }, 'x64'));
  assert.throws(() => release(feed, 'ia32'));
});

test('official installation verifies Windows registration, re-resolves the path and never downgrades', async () => {
  const source = path.resolve('official-old');
  const target = path.resolve('official-new');
  let installed = { app: source, arch: 'x64', version: '26.915.4065.0' }, executions = 0;
  const events = [];
  const options = { realpath: value => value, native: action => {
    if (action === 'store-context') return { packages: [installed] };
    assert.equal(action, 'official-feed'); return feed;
  }, onProgress: value => events.push(value), execute: async (payload, progress) => {
    executions++;
    assert.equal(payload.version, feed.buildVersion);
    assert.equal(payload.arch, 'x64');
    progress({ phase: 'downloading', percent: 32 });
    installed = { ...installed, app: target, version: feed.buildVersion };
    return { status: 'installed' };
  } };
  const result = await official.install('state', source, options);
  assert.equal(result.source, target);
  assert.equal(result.version, feed.buildVersion);
  assert.deepEqual(events, [{ phase: 'downloading', percent: 32, targetVersion: feed.buildVersion }]);
  for (const current of [feed.buildVersion, '27.0.0.0']) {
    installed.version = current;
    assert.deepEqual(await official.install('state', target, options), { status: 'current', version: current });
  }
  assert.equal(executions, 1);
  await assert.rejects(official.install('state', 'custom-source', options), /registered production app/);
  installed.version = '26.915.4065.0';
  await assert.rejects(official.install('state', target, { ...options, execute: async () => ({ status: 'installed' }) }), /not registered/);
});

test('official download holds the shared installation lock and saves progress and failure for cleanup', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-official-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  store.saveJson(store.configPath(state), { autoDiscover: false, source: 'official', enabled: true });
  t.mock.method(updates, 'recordFor', (root, id) => {
    assert.equal(root, state); assert.equal(id, 'copy-id');
  });
  const options = { resolve: () => 'official', stopped: apps => assert.deepEqual(apps, ['official']),
    installOfficial: async (root, source, { onProgress }) => {
      assert.equal(root, state); assert.equal(source, 'official');
      assert.equal((await store.withLock(state, () => assert.fail('must not interleave a second installer'))).status, 'busy');
      onProgress({ phase: 'downloading', percent: 25 });
      assert.equal(store.readOptional(official.statusPath(state)).percent, 25);
      throw new Error('Network unavailable');
    } };
  await assert.rejects(official.update(state, 'copy-id', options), /Network unavailable/);
  const failed = store.readOptional(official.statusPath(state));
  assert.equal(failed.phase, 'failed'); assert.equal(failed.id, 'copy-id');
  assert.equal(store.readOptional(store.configPath(state)).source, 'official');
  assert.ok(cleanup.plan(state).targets.includes(official.statusPath(state)));
  options.installOfficial = async () => ({ status: 'installed', version: feed.buildVersion, source: 'official-new' });
  await official.update(state, 'copy-id', options);
  assert.equal(store.readOptional(official.statusPath(state)).phase, 'complete');
  assert.deepEqual(store.readOptional(store.configPath(state)), { autoDiscover: false, source: 'official-new', enabled: true });
});

test('installer transport handles split UTF-8 progress, native errors and timeouts', async () => {
  function fixture(output, exitCode = 0) {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('close', 1);
    const start = (_exe, args, options) => {
      assert.equal(options.windowsHide, true);
      assert.deepEqual(JSON.parse(Buffer.from(args.at(-1), 'base64').toString('utf8')), { state: 'state' });
      if (output != null) queueMicrotask(() => {
        for (const byte of Buffer.from(output)) child.stdout.write(Buffer.from([byte]));
        child.emit('close', exitCode);
      });
      return child;
    };
    return { start, timeoutMs: 1000 };
  }
  const events = [];
  const result = await official.run({ state: 'state' }, value => events.push(value),
    fixture('{"phase":"downloading","percent":40}\n{"result":{"status":"installed"}}\n'));
  assert.equal(result.status, 'installed'); assert.equal(events[0].percent, 40);
  await assert.rejects(official.run({ state: 'state' }, () => {}, fixture('{"error":"安装失败"}', 1)), /安装失败/);
  await assert.rejects(official.run({ state: 'state' }, () => {}, fixture('{}\n')), /did not complete/);
  await assert.rejects(official.run({ state: 'state' }, () => {}, { ...fixture(null), timeoutMs: 10 }), /timed out/);
});

test('real PowerShell validates MSIX identity and propagates Windows signature failure', { skip: process.platform !== 'win32' }, t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-msix-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const output = require('node:child_process').execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, '../support/windows-official-update.ps1'), '-Root', path.resolve(__dirname, '../..'),
    '-Temporary', temporary], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.match(output, /deployment checks passed/);
});
