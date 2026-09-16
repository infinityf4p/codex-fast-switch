const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tx = require('../../src/platforms/macos/transaction.cjs');
const automatic = require('../../src/platforms/macos/automatic.cjs');
const storage = require('../../src/platforms/macos/storage.cjs');
const { restart } = require('../../src/platforms/macos/restart.cjs');

function fixture(initiallyRunning = true) {
  const calls = [];
  let running = initiallyRunning;
  let time = 0;
  return { calls, options: {
    running: () => running,
    quit: () => { calls.push('quit'); running = false; },
    install: async (app, state, { beforeActivate }) => {
      await beforeActivate();
      calls.push('install');
      assert.equal(running, false);
      return { status: 'installed' };
    },
    open: () => { calls.push('open'); running = true; },
    safeToOpen: () => true,
    now: () => time,
    wait: async ms => { calls.push('wait'); time += ms; },
  } };
}

test('restart activates and opens without a fixed delay or UI probe', async () => {
  const f = fixture();
  const result = await restart('/app', '/state', f.options);
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
  assert.equal(result.reopened, true);
});

test('preparation finishes while the app is running and is excluded from the closed interval', async () => {
  const f = fixture();
  const result = await restart('/app', '/state', { ...f.options,
    install: async (app, state, options) => {
      assert.equal(f.options.running(), true);
      await f.options.wait(1000);
      f.calls.push('prepared');
      const result = await f.options.install(app, state, options);
      await f.options.wait(20);
      return result;
    },
  });
  assert.deepEqual(f.calls, ['wait', 'prepared', 'quit', 'install', 'wait', 'open']);
  assert.equal(result.preparationMilliseconds, 1000);
  assert.equal(result.closedMilliseconds, 20);
});

test('preparation failure leaves the running app alone', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options,
    install: async () => { throw new Error('signature failed during preparation'); },
  }), /signature failed/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.options.running(), true);
});

test('an already patched app is left running', async () => {
  const f = fixture();
  const result = await restart('/app', '/state', { ...f.options, patched: () => true });
  assert.deepEqual(f.calls, []);
  assert.equal(result.status, 'already-installed');
  assert.equal(result.reopened, false);
});

test('an installed revision 4 is upgraded instead of skipping the new signing step', async t => {
  const f = fixture();
  t.mock.method(tx, 'marker', () => ({ patchId: tx.PATCH_ID, revision: 4, id: 'previous' }));
  t.mock.method(tx, 'checkedRecord', () => ({ phase: 'installed', id: 'previous', patched: {} }));
  t.mock.method(tx, 'same', () => true);
  assert.equal((await restart('/app', '/state', f.options)).status, 'installed');
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
});

test('enabling the Storage helper reapplies an otherwise current patch', async t => {
  const f = fixture();
  t.mock.method(tx, 'marker', () => ({ patchId: tx.PATCH_ID, revision: tx.PATCH_REVISION, id: 'current' }));
  t.mock.method(tx, 'checkedRecord', () => ({ phase: 'installed', id: 'current', patched: {} }));
  t.mock.method(tx, 'same', () => true);
  t.mock.method(storage, 'matchesMarker', () => false);
  assert.equal((await restart('/app', '/state', f.options)).status, 'installed');
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
});

test('an already patched closed app is opened without being quit', async () => {
  const f = fixture(false);
  const result = await restart('/app', '/state', { ...f.options, patched: () => true });
  assert.deepEqual(f.calls, ['open']);
  assert.equal(result.status, 'already-installed');
  assert.equal(result.reopened, true);
});

test('a KeepAlive-style restart loop stops after the first successful patch', async () => {
  const f = fixture();
  let patched = false;
  const options = {
    ...f.options,
    patched: () => patched,
    install: async (...args) => {
      const result = await f.options.install(...args);
      patched = true;
      return result;
    },
  };
  assert.equal((await restart('/app', '/state', options)).reopened, true);
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
  f.calls.length = 0;
  for (let i = 0; i < 5; i++) {
    const result = await restart('/app', '/state', options);
    assert.equal(result.status, 'already-installed');
    assert.equal(result.reopened, false);
  }
  assert.deepEqual(f.calls, []);
});

test('an already closed app is patched and opened directly', async () => {
  const f = fixture(false);
  await restart('/app', '/state', f.options);
  assert.deepEqual(f.calls, ['install', 'open']);
});

test('cancelled quit times out without changing the app', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options, timeoutMs: 200,
    quit: () => f.calls.push('quit') }), { code: 'QUIT_TIMEOUT' });
  assert.deepEqual(f.calls, ['quit', 'wait']);
});

test('manual restart cancellation preserves the last successful build for update monitoring', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-restart-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  tx.saveJson(automatic.statusPath(root), { successStamp: JSON.stringify(1) });
  const f = fixture();
  await assert.rejects(automatic.restart(root, root, { ...f.options, timeoutMs: 200,
    stopJobs: () => {}, ensureIdentity: () => {}, getStamp: () => 2,
    quit: () => f.calls.push('quit'),
    onPhase: () => assert.equal(automatic.status(root).lastCheck.successStamp, JSON.stringify(1)),
  }), { code: 'QUIT_TIMEOUT' });
  assert.equal(automatic.status(root).lastCheck.successStamp, JSON.stringify(1));
  assert.equal(automatic.status(root).lastCheck.status, 'waiting-for-exit');
  assert.equal(automatic.status(root).lastCheck.attemptedStamp, JSON.stringify(2));
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  assert.equal((await automatic.tick(root, { getStamp: () => 2, updaterBusy: () => false,
    stopped: () => { throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); },
    restartApp: () => assert.fail('manual cancellation must not trigger another automatic restart'),
  })).status, 'waiting-for-exit');
});

test('failure reopens the preserved or restored original', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options,
    install: async (app, state, options) => { await f.options.install(app, state, options); throw new Error('activation failed'); } }),
  error => error.message === 'activation failed' && error.reopenedAfterFailure);
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
});

test('pending recovery is left stopped so restoration can finish', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options, safeToOpen: () => false,
    install: async (app, state, { beforeActivate }) => { await beforeActivate(); throw new Error('rollback pending'); } }),
  error => error.message === 'rollback pending' && error.reopenedAfterFailure === false);
  assert.deepEqual(f.calls, ['quit']);
});

test('recovery is not reported as a successful installation', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options,
    install: async (app, state, { beforeActivate }) => { await beforeActivate(); return { status: 'rolled-back' }; } }), /Patch was not installed: rolled-back/);
  assert.deepEqual(f.calls, ['quit', 'open']);
});
