const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const adaptive = require('../../src/core/adaptive.cjs');
const { restart } = require('../../src/platforms/macos/restart.cjs');
const { snippets, recipes } = require('../support/fixtures.cjs');

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-transaction-unit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'Codex.app');
  const state = path.join(root, 'state');
  const files = ['Contents/Info.plist', 'Contents/MacOS/Test', 'Contents/_CodeSignature/CodeResources'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), 'official');
  }
  const source = path.join(root, 'archive-source');
  fs.mkdirSync(path.join(source, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: 'test', codexBuildNumber: 1 }));
  snippets.forEach((snippet, i) => fs.writeFileSync(path.join(source, `webview/chunk-${i}.js`), snippet));
  fs.mkdirSync(path.join(app, 'Contents/Resources'));
  await finished(await asar.createPackage(source, path.join(app, 'Contents/Resources/app.asar')));
  const f = { root, app, state, running: true, calls: [], plans: 0, time: 0 };
  const signing = {
    ensureIdentity: () => ({ certificateSha256: 'test-certificate' }),
    sign: candidate => {
      f.calls.push('sign');
      assert.equal(candidate.startsWith(root + path.sep), true);
      if (f.signFailure) throw new Error('test signing failure');
      fs.writeFileSync(path.join(candidate, 'Contents/_CodeSignature/CodeResources'), 'patched');
      f.afterSign?.();
    },
  };
  const mocks = {
    './storage.cjs': {
      copyBridge: () => f.storageEnabled ? { revision: 1, certificateSha256: 'test-certificate' } : null,
      matchesMarker: (state, app, current) => Boolean(current.storageHelper) === Boolean(f.storageEnabled),
    },
    './update-hook.cjs': {
      plan: () => ({ entry: 'package.json', sourceSha256: require('../../src/core/archive.cjs').sha256(asar.extractFile(path.join(app, 'Contents/Resources/app.asar'), 'package.json')),
        patched: asar.extractFile(path.join(app, 'Contents/Resources/app.asar'), 'package.json') }),
      copyResources: () => {},
    },
    './signing.cjs': signing,
    './platform.cjs': {
      identityFiles: () => [...files, 'Contents/Resources/app.asar'],
      assertStopped: target => {
        if (target === app && f.running) throw Object.assign(new Error('running'), { code: 'APP_RUNNING' });
      },
    },
    '../../core/adaptive.cjs': { planArchive: archive => {
      f.plans++;
      return adaptive.planArchive(archive, recipes);
    } },
    'node:child_process': { execFileSync: (command, args) => {
      if (command === '/usr/bin/codesign' || command === '/usr/libexec/PlistBuddy' || command === '/usr/bin/xattr') return;
      if (command === '/bin/cp') {
        f.calls.push('copy');
        fs.cpSync(args[1], args[2], { recursive: true });
        return;
      }
      assert.equal(path.basename(command), 'native-helper');
      assert.equal(args[0], 'swap');
      assert.equal(f.running, false);
      f.calls.push('swap');
      const temporary = path.join(root, 'exchange');
      fs.renameSync(args[1], temporary);
      fs.renameSync(args[2], args[1]);
      fs.renameSync(temporary, args[2]);
    } },
  };
  const filename = path.join(__dirname, '../../src/platforms/macos/transaction.cjs');
  const realRequire = createRequire(filename);
  const moduleStub = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name),
    module: moduleStub, exports: moduleStub.exports, __dirname: path.dirname(filename), process,
  }, { filename });
  f.tx = moduleStub.exports;
  f.original = f.tx.fingerprint(app);
  f.run = () => f.tx.withLock(state, () => restart(app, state, {
    install: f.tx.install, patched: () => false, running: () => f.running,
    quit: () => { f.calls.push('quit'); if (!f.cancelQuit) f.running = false; },
    open: () => { f.calls.push('open'); f.running = true; },
    safeToOpen: () => f.tx.checkedRecord(state, app)?.phase !== 'rollback-pending',
    onPhase: phase => { if (phase === f.failPhase) throw new Error(`test failure at ${phase}`); },
    timeoutMs: 200, now: () => f.time, wait: async ms => { f.time += ms; },
  }));
  f.assertCleanStage = () => assert.equal(fs.readdirSync(root).some(name => name.startsWith('.codex-fast-auto-')), false);
  return f;
}

test('real transaction prepares once before quit and retains a restorable original', async t => {
  const f = await fixture(t);
  f.afterSign = () => assert.equal(f.running, true);
  const result = await f.run();
  assert.equal(result.status, 'installed');
  assert.equal(f.plans, 1);
  assert.deepEqual(f.calls, ['copy', 'sign', 'quit', 'swap', 'open']);
  assert.equal(f.tx.checkedRecord(f.state, f.app).phase, 'installed');
  f.assertCleanStage();
  f.running = false;
  assert.equal(f.tx.restore(f.app, f.state).status, 'restored');
  assert.deepEqual(f.tx.fingerprint(f.app), f.original);
});

test('signing failure discards the candidate without quitting or changing the app', async t => {
  const f = await fixture(t);
  f.signFailure = true;
  await assert.rejects(f.run(), /test signing failure/);
  assert.deepEqual(f.calls, ['copy', 'sign']);
  assert.equal(f.running, true);
  assert.deepEqual(f.tx.fingerprint(f.app), f.original);
  f.assertCleanStage();
});

test('cancelled quit removes the prepared candidate and leaves the app byte-identical', async t => {
  const f = await fixture(t);
  f.cancelQuit = true;
  await assert.rejects(f.run(), { code: 'QUIT_TIMEOUT' });
  assert.deepEqual(f.calls, ['copy', 'sign', 'quit']);
  assert.equal(f.running, true);
  assert.deepEqual(f.tx.fingerprint(f.app), f.original);
  f.assertCleanStage();
});

test('a newer update during preparation is retained without requesting quit', async t => {
  const f = await fixture(t);
  f.afterSign = () => fs.appendFileSync(path.join(f.app, 'Contents/MacOS/Test'), '-newer');
  await assert.rejects(f.run(), { code: 'UPDATE_IN_PROGRESS' });
  assert.deepEqual(f.calls, ['copy', 'sign']);
  assert.equal(f.running, true);
  assert.equal(fs.readFileSync(path.join(f.app, 'Contents/MacOS/Test'), 'utf8'), 'official-newer');
  f.assertCleanStage();
});

test('a failure after exchange still restores and reopens the original', async t => {
  const f = await fixture(t);
  f.failPhase = 'exchanged';
  await assert.rejects(f.run(), /test failure at exchanged/);
  assert.deepEqual(f.calls, ['copy', 'sign', 'quit', 'swap', 'swap', 'open']);
  assert.equal(f.running, true);
  assert.equal(f.tx.checkedRecord(f.state, f.app).phase, 'rolled-back');
  assert.deepEqual(f.tx.fingerprint(f.app), f.original);
  f.assertCleanStage();
});

test('direct installation still refuses a running app without a quit callback', async t => {
  const f = await fixture(t);
  await assert.rejects(f.tx.install(f.app, f.state), { code: 'APP_RUNNING' });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.tx.fingerprint(f.app), f.original);
});

test('enabling the helper replaces a current patch and preserves its official backup', async t => {
  const f = await fixture(t);
  await f.run();
  const previous = f.tx.marker(f.app);
  f.storageEnabled = true;
  await f.run();
  const current = f.tx.marker(f.app);
  assert.equal(current.revision, previous.revision);
  assert.notEqual(current.id, previous.id);
  assert.equal(current.storageHelper.revision, 1);
  f.running = false;
  f.tx.restore(f.app, f.state);
  assert.deepEqual(f.tx.fingerprint(f.app), f.original);
});
