const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { relaunch } = require('../../src/platforms/macos/relaunch.cjs');

function fixture(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-relaunch-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const app = path.join(state, 'Codex.app');
  fs.writeFileSync(path.join(state, 'automatic.json'), JSON.stringify({ enabled: true, app }));
  const f = { state, app, time: 0, calls: [], busy: 0, parent: 0, opened: false, lockBusy: 0 };
  f.options = {
    running: () => f.opened, updaterBusy: () => f.busy-- > 0,
    appPresent: () => true,
    open: () => { f.calls.push('open'); f.opened = true; },
    tick: async (state, options) => {
      f.calls.push('patch');
      if (f.error) options.notifyUser(f.error);
      return { status: f.result || 'installed' };
    },
    lock: async (state, fn) => f.lockBusy-- > 0 ? { status: 'busy' } : fn(),
    record: () => ({ phase: f.phase || 'installed' }),
    parentPid: 100, parentAlive: () => f.parent-- > 0,
    now: () => f.time, wait: async ms => { f.time += ms; f.calls.push('wait'); },
    timeoutMs: 1000, notify: message => f.calls.push(message),
  };
  f.run = () => relaunch(state, app, f.options);
  return f;
}

test('update handoff waits for the old process and Sparkle, then patches before opening once', async t => {
  const f = fixture(t);
  f.parent = 1;
  f.busy = 1;
  assert.equal((await f.run()).patch, 'installed');
  assert.deepEqual(f.calls, ['wait', 'wait', 'patch', 'open']);
});

test('an incompatible update opens the retained official app before its error dialog', async t => {
  const f = fixture(t);
  f.result = 'failed';
  f.error = 'unsupported code';
  assert.equal((await f.run()).patch, 'failed');
  assert.deepEqual(f.calls, ['patch', 'open', 'unsupported code']);
});

test('a pending rollback does not open the partially committed app', async t => {
  const f = fixture(t);
  f.phase = 'rollback-pending';
  await assert.rejects(f.run(), /recovery is pending/);
  assert.deepEqual(f.calls, ['patch']);
});

test('cancelled quit does not patch or reopen the running app', async t => {
  const f = fixture(t);
  f.parent = 100;
  assert.equal((await f.run()).status, 'quit-cancelled');
  assert.equal(f.calls.includes('patch'), false);
  assert.equal(f.calls.includes('open'), false);
});

test('a user-opened app is not restarted by the handoff worker', async t => {
  const f = fixture(t);
  f.opened = true;
  assert.equal((await f.run()).status, 'already-open');
  assert.deepEqual(f.calls, []);
});

test('a concurrent monitor is allowed to finish before opening', async t => {
  const f = fixture(t);
  f.lockBusy = 1;
  f.result = 'idle';
  assert.equal((await f.run()).status, 'reopened');
  assert.deepEqual(f.calls, ['patch', 'wait', 'patch', 'open']);
});

test('a still-running official updater is not interrupted on timeout', async t => {
  const f = fixture(t);
  f.busy = 100;
  await assert.rejects(f.run(), /has not finished/);
  assert.equal(f.calls.includes('open'), false);
  assert.equal(f.calls.includes('patch'), false);
});

test('handoff waits for bundle replacement before reading app metadata', async t => {
  const f = fixture(t);
  f.busy = 1;
  let missing = 1;
  let present = false;
  f.options.appPresent = () => { present = missing-- <= 0; return present; };
  f.options.running = () => {
    assert.equal(present, true, 'Do not inspect app metadata while the bundle is missing.');
    return f.opened;
  };
  assert.equal((await f.run()).status, 'reopened');
  assert.deepEqual(f.calls, ['wait', 'wait', 'patch', 'open']);
});
