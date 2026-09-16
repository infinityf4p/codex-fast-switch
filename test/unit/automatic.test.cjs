const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tx = require('../../src/platforms/macos/transaction.cjs');
const automatic = require('../../src/platforms/macos/automatic.cjs');
const { restart } = require('../../src/platforms/macos/restart.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root, model: 'example-model' });
  tx.saveJson(automatic.statusPath(root), { successStamp: JSON.stringify(1) });
  const f = { root, generation: 2, running: true, time: 0, calls: [], notices: [] };
  f.runtime = {
    running: () => f.running, patched: () => false, safeToOpen: () => true,
    quit: () => { f.calls.push('quit'); f.running = false; },
    open: () => { f.calls.push('open'); f.running = true; },
    now: () => f.time, wait: async ms => { f.time += ms; }, timeoutMs: 200,
  };
  f.options = {
    getStamp: () => f.generation, updaterBusy: () => false,
    stopped: () => { if (f.running) throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); },
    restartApp: (app, state, options) => restart(app, state, { ...options, ...f.runtime }),
    install: async (app, state, options) => {
      f.calls.push('prepare');
      await options.beforeActivate?.();
      assert.equal(f.running, false);
      assert.equal(options.model, 'example-model');
      f.calls.push('install');
      f.generation++;
      return { status: 'installed' };
    },
    notifyUser: message => f.notices.push(message),
  };
  return f;
}

test('unsupported automatic updates are reported once before quit and a later build can succeed', async t => {
  const f = fixture(t);
  const unsupported = { ...f.options, install: async () => { f.calls.push('prepare'); throw new Error('unsupported build'); } };
  const result = await automatic.tick(f.root, unsupported);
  assert.equal(result.status, 'failed');
  assert.equal(result.successStamp, JSON.stringify(1));
  assert.equal((await automatic.tick(f.root, unsupported)).status, 'rejected-until-next-update');
  assert.deepEqual(f.calls, ['prepare']);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /unsupported build/);
  f.generation++;
  assert.equal((await automatic.tick(f.root, f.options)).status, 'installed');
  assert.deepEqual(f.calls, ['prepare', 'prepare', 'quit', 'install', 'open']);
  assert.equal((await automatic.tick(f.root, f.options)).status, 'idle');
});

test('phase and completion timestamps reflect progress during a long preparation', async t => {
  const f = fixture(t);
  const install = f.options.install;
  const result = await automatic.tick(f.root, { ...f.options, now: () => f.time,
    install: async (app, state, options) => {
      f.time = 7000;
      options.onPhase('recognizing');
      assert.equal(automatic.status(f.root).lastCheck.checkedAt, new Date(7000).toISOString());
      const result = await install(app, state, options);
      f.time = 9000;
      return result;
    },
  });
  assert.equal(result.status, 'installed');
  assert.equal(result.checkedAt, new Date(9000).toISOString());
});

test('a pending helper installation still applies after a cancelled quit on the same build', async t => {
  const f = fixture(t);
  f.generation = 1;
  tx.saveJson(automatic.statusPath(f.root), { successStamp: JSON.stringify(1), attemptedStamp: JSON.stringify(1), needsApply: true });
  assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  assert.deepEqual(f.calls, []);
  f.running = false;
  assert.equal((await automatic.tick(f.root, f.options)).status, 'installed');
  assert.deepEqual(f.calls, ['prepare', 'install']);
  assert.equal(automatic.status(f.root).lastCheck.needsApply, false);
  assert.equal((await automatic.tick(f.root, f.options)).status, 'idle');
});

test('a lost status baseline recovers automatic restart from the previous installed build', async t => {
  const f = fixture(t);
  tx.saveJson(automatic.statusPath(f.root), { status: 'waiting-for-exit', attemptedStamp: JSON.stringify(1), error: 'old quit timeout' });
  t.mock.method(tx, 'checkedRecord', () => ({ phase: 'installed', version: 'old', build: '8109' }));
  t.mock.method(tx, 'version', () => ({ version: 'new', build: '8576' }));
  const result = await automatic.tick(f.root, f.options);
  assert.equal(result.status, 'installed');
  assert.equal(result.successStamp, JSON.stringify(3));
  assert.equal(result.error, null);
  assert.deepEqual(f.calls, ['prepare', 'quit', 'install', 'open']);
});

test('the durable record does not restart a same-build restore or a fresh installation', async t => {
  const f = fixture(t);
  tx.saveJson(automatic.statusPath(f.root), { status: 'enabled' });
  const record = { phase: 'installed', version: 'old', build: '8109' };
  t.mock.method(tx, 'checkedRecord', () => record);
  t.mock.method(tx, 'version', () => ({ version: 'old', build: '8109' }));
  assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  record.phase = 'restored';
  t.mock.method(tx, 'version', () => ({ version: 'new', build: '8576' }));
  assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  assert.deepEqual(f.calls, []);
});

test('a recovered baseline still respects a cancelled restart for the current build', async t => {
  const f = fixture(t);
  tx.saveJson(automatic.statusPath(f.root), { attemptedStamp: JSON.stringify(2) });
  t.mock.method(tx, 'checkedRecord', () => ({ phase: 'installed', version: 'old', build: '8109' }));
  t.mock.method(tx, 'version', () => ({ version: 'new', build: '8576' }));
  assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  assert.deepEqual(f.calls, []);
});

test('automatic activation failures reopen the original and notify once', async t => {
  const f = fixture(t);
  const options = { ...f.options, install: async (app, state, { beforeActivate }) => {
    f.calls.push('prepare');
    await beforeActivate();
    f.calls.push('install');
    throw new Error('activation failed');
  } };
  const result = await automatic.tick(f.root, options);
  assert.equal(result.status, 'failed');
  assert.equal(result.successStamp, JSON.stringify(1));
  assert.equal(f.running, true);
  assert.deepEqual(f.calls, ['prepare', 'quit', 'install', 'open']);
  assert.equal((await automatic.tick(f.root, options)).status, 'rejected-until-next-update');
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /activation failed/);
});

test('cancelled auto-restarts are attempted once per build while manual exit can still apply', async t => {
  const f = fixture(t);
  f.runtime.quit = () => { f.calls.push('quit'); };
  const cancelled = await automatic.tick(f.root, f.options);
  assert.equal(cancelled.status, 'waiting-for-exit');
  assert.equal(cancelled.successStamp, JSON.stringify(1));
  assert.equal(cancelled.attemptedStamp, JSON.stringify(2));
  for (let i = 0; i < 3; i++) assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  assert.deepEqual(f.calls, ['prepare', 'quit']);
  f.generation++;
  assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  assert.deepEqual(f.calls, ['prepare', 'quit', 'prepare', 'quit']);
  f.running = false;
  assert.equal((await automatic.tick(f.root, f.options)).status, 'installed');
  assert.equal(f.calls.at(-1), 'install');
  assert.equal(f.notices.length, 0);
});

test('an app replaced again during preparation is left running until the next monitor tick', async t => {
  const f = fixture(t);
  const result = await automatic.tick(f.root, { ...f.options,
    install: async (app, state, { beforeActivate }) => {
      f.calls.push('prepare');
      f.generation++;
      await beforeActivate();
      assert.fail('obsolete candidate must not be activated');
    } });
  assert.equal(result.status, 'waiting-for-update');
  assert.equal(result.attemptedStamp, undefined);
  assert.deepEqual(f.calls, ['prepare']);
  assert.equal((await automatic.tick(f.root, f.options)).status, 'installed');
});

test('an updater that starts during preparation defers quit', async t => {
  const f = fixture(t);
  let checks = 0;
  const result = await automatic.tick(f.root, { ...f.options, updaterBusy: () => ++checks > 1 });
  assert.equal(result.status, 'waiting-for-update');
  assert.equal(checks, 2);
  assert.equal(result.attemptedStamp, undefined);
  assert.deepEqual(f.calls, ['prepare']);
});

test('an app that disappears after preparation is retried without quitting or rejecting the update', async t => {
  const f = fixture(t);
  let missing = false;
  const result = await automatic.tick(f.root, { ...f.options,
    getStamp: () => { if (missing) throw new Error('app is being replaced'); return f.generation; },
    install: async (app, state, { beforeActivate }) => {
      f.calls.push('prepare');
      missing = true;
      await beforeActivate();
      assert.fail('must not activate while the app is missing');
    },
  });
  assert.equal(result.status, 'waiting-for-update');
  assert.equal(result.rejectedStamp, undefined);
  assert.equal(result.attemptedStamp, undefined);
  assert.deepEqual(f.calls, ['prepare']);
  assert.equal(f.notices.length, 0);
});

test('pending recovery is not adopted as a fresh update while the app is running', async t => {
  const f = fixture(t);
  t.mock.method(tx, 'checkedRecord', () => ({ phase: 'rollback-pending' }));
  assert.equal((await automatic.tick(f.root, f.options)).status, 'waiting-for-exit');
  assert.deepEqual(f.calls, []);
});

test('a failed failure notification is recorded without another restart or notification', async t => {
  const f = fixture(t);
  let notices = 0;
  const options = { ...f.options,
    install: async () => { throw new Error('unsupported build'); },
    notifyUser: () => { notices++; throw new Error('notification unavailable'); },
  };
  const result = await automatic.tick(f.root, options);
  assert.equal(result.notificationError, 'notification unavailable');
  assert.equal(automatic.status(f.root).lastCheck.notificationError, 'notification unavailable');
  assert.equal((await automatic.tick(f.root, options)).status, 'rejected-until-next-update');
  assert.equal(notices, 1);
  assert.deepEqual(f.calls, []);
});
