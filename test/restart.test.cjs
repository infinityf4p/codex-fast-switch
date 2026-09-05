const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restart } = require('../lib/restart.cjs');

function fixture(initiallyRunning = true) {
  const calls = [];
  let running = initiallyRunning;
  let time = 0;
  return { calls, options: {
    running: () => running,
    quit: () => { calls.push('quit'); running = false; },
    install: async () => { calls.push('install'); assert.equal(running, false); return { status: 'installed' }; },
    open: () => { calls.push('open'); running = true; },
    safeToOpen: () => true,
    now: () => time,
    wait: async ms => { calls.push('wait'); time += ms; },
  } };
}

test('restart quits, patches and opens without a fixed delay or UI probe', async () => {
  const f = fixture();
  const result = await restart('/app', '/state', f.options);
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
  assert.equal(result.reopened, true);
});

test('an already patched app is left running', async () => {
  const f = fixture();
  const result = await restart('/app', '/state', { ...f.options, patched: () => true });
  assert.deepEqual(f.calls, []);
  assert.equal(result.status, 'already-installed');
  assert.equal(result.reopened, false);
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
    install: async () => {
      const result = await f.options.install();
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

test('failure reopens the preserved or restored original', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options,
    install: async () => { f.calls.push('install'); throw new Error('unsupported build'); } }),
  error => error.message === 'unsupported build' && error.reopenedAfterFailure);
  assert.deepEqual(f.calls, ['quit', 'install', 'open']);
});

test('pending recovery is left stopped so restoration can finish', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options, safeToOpen: () => false,
    install: async () => { throw new Error('rollback pending'); } }),
  error => error.message === 'rollback pending' && error.reopenedAfterFailure === false);
  assert.deepEqual(f.calls, ['quit']);
});

test('recovery is not reported as a successful installation', async () => {
  const f = fixture();
  await assert.rejects(restart('/app', '/state', { ...f.options,
    install: async () => ({ status: 'rolled-back' }) }), /Patch was not installed: rolled-back/);
  assert.deepEqual(f.calls, ['quit', 'open']);
});
