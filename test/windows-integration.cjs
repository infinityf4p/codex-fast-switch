const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const platform = require('../windows/platform.cjs');
const store = require('../windows/store.cjs');
const automatic = require('../windows/automatic.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}
async function locked(state, action) {
  let result;
  await until(async () => { result = await store.withLock(state, action); return result?.status !== 'busy'; }, 'installer lock');
  return result;
}
async function main() {
  platform.requireWindows();
  const state = path.resolve(process.argv[2] || (() => { throw new Error('Pass an isolated test --state directory as the first argument.'); })());
  if (state.toLowerCase() === platform.DEFAULT_STATE.toLowerCase()) throw new Error('Use a separate test state directory.');
  const source = platform.discoverApp(process.env.CODEX_FAST_TEST_APP);
  const original = platform.fingerprint(source);
  let enabled;
  try {
    const installed = await locked(state, () => store.install(source, state, { onPhase: phase => console.log(phase) }));
    assert.ok(['installed', 'already-installed'].includes(installed.status));
    platform.verify(store.checkedActive(state).app, { patched: true });
    enabled = await locked(state, () => automatic.enable(state, source, { autoDiscover: true }));
    assert.ok(fs.existsSync(enabled.shortcut));
    await until(() => store.readOptional(store.statusPath(state))?.status === 'waiting-for-exit', 'monitor waiting for running original');
    console.log('Startup worker is running and waits for the original app to exit.');
    const firstWorker = store.readOptional(store.configPath(state)).workerId;
    await locked(state, () => automatic.enable(state, source, { autoDiscover: true }));
    assert.notEqual(store.readOptional(store.configPath(state)).workerId, firstWorker);
    await until(() => store.readOptional(store.statusPath(state))?.status === 'waiting-for-exit', 'replacement worker', 40000);
    console.log('Re-enabling monitoring replaced the worker successfully.');
  } finally {
    await locked(state, () => automatic.disable(state));
    await until(() => !fs.existsSync(path.join(state, 'watcher/automatic.lock')), 'monitor stopped', 45000);
    if (enabled) assert.equal(fs.existsSync(enabled.shortcut), false);
    assert.equal(platform.same(source, original), true);
  }
  const restored = await locked(state, () => store.restore(state));
  assert.equal(restored.status, 'restored');
  assert.equal(store.checkedActive(state), null);
  assert.equal(platform.same(source, original), true);
  console.log(JSON.stringify({ passed: true, ...platform.metadata(source), startupMonitor: true,
    reenable: true, restored: true, originalUnchanged: true, startupShortcutRemoved: true }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
