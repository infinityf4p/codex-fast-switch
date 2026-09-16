const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const automatic = require('../../src/platforms/macos/automatic.cjs');
const tx = require('../../src/platforms/macos/transaction.cjs');
const { watch } = require('../../src/platforms/macos/watch.cjs');

async function fixture(t, status = 'idle') {
  const f = { app: path.resolve('/selected/Codex.app'), now: 0, status, calls: 0, timers: new Map() };
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => queueMicrotask(() => child.emit('close'));
  const directory = new EventEmitter();
  directory.close = () => { f.directoryClosed = true; };
  t.mock.method(tx, 'readJson', () => ({ enabled: true, app: f.app }));
  t.mock.method(automatic, 'stopStrayRestartJobs', () => {});
  t.mock.method(fs, 'watch', (parent, callback) => {
    assert.equal(parent, path.dirname(f.app));
    f.changed = callback;
    return directory;
  });
  t.mock.method(Date, 'now', () => f.now);
  t.mock.method(global, 'setTimeout', (fn, delay) => {
    const timer = { fn, delay };
    f.timers.set(timer, timer);
    return timer;
  });
  t.mock.method(global, 'clearTimeout', timer => f.timers.delete(timer));
  const work = watch('/state', {
    spawnObserver: () => child,
    tick: async () => { f.calls++; return { status: f.status }; },
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  t.after(async () => {
    process.emit('SIGTERM');
    await work;
    assert.equal(f.directoryClosed, true);
    assert.equal(f.timers.size, 0);
  });
  f.delay = () => [...f.timers.values()][0]?.delay;
  f.advance = async () => {
    const timer = [...f.timers.values()][0];
    assert.ok(timer);
    f.timers.delete(timer);
    f.now += timer.delay;
    timer.fn();
    await flush();
  };
  f.launched = async () => { child.stdout.write('launched\n'); await flush(); };
  f.exited = async () => { child.stdout.write('exited\n'); await flush(); };
  f.flush = flush;
  await flush();
  return f;
}

test('app launch and replacement wake the monitor without waiting for polling', async t => {
  const f = await fixture(t);
  assert.equal(f.calls, 1);
  assert.equal(f.delay(), 10000);
  await f.launched();
  assert.equal(f.calls, 2);
  f.changed('rename', 'Other.app');
  await f.flush();
  assert.equal(f.calls, 2);
  f.changed('rename', path.basename(f.app));
  await f.flush();
  assert.equal(f.calls, 3);
  await f.exited();
  assert.equal(f.calls, 4);
  assert.equal(f.now, 0);
});

test('an update is retried after 250 ms and normal polling resumes once it completes', async t => {
  const f = await fixture(t, 'waiting-for-update');
  assert.equal(f.delay(), 250);
  f.status = 'installed';
  await f.advance();
  assert.equal(f.calls, 2);
  assert.equal(f.now, 250);
  assert.equal(f.delay(), 10000);
});

test('fast update polling is bounded and a new app event opens a fresh window', async t => {
  const f = await fixture(t, 'waiting-for-update');
  f.now = 30000;
  await f.advance();
  assert.equal(f.delay(), 10000);
  await f.launched();
  assert.equal(f.delay(), 250);
});
