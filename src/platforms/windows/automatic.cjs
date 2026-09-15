const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const launcher = require('./launcher.cjs');
const WORKER_LAYOUT = 1;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = platform.stamp;
const serviceName = state => `Codex Fast Switch ${crypto.createHash('sha256').update(path.resolve(state).toLowerCase()).digest('hex').slice(0, 12)}`;

async function tick(state, { resolve = store.resolveSource, stopped = platform.assertStopped,
  install = launcher.install, repairShortcuts = launcher.refresh, getStamp = stamp, now = Date.now } = {}) {
  return store.withLock(state, async () => {
    const config = store.readOptional(store.configPath(state));
    if (!config?.enabled) return { status: 'disabled' };
    const previous = store.readOptional(store.statusPath(state)) || {};
    const finish = (status, extra = {}) => {
      const result = { ...previous, status, checkedAt: new Date(now()).toISOString(), ...extra };
      store.saveJson(store.statusPath(state), result);
      return result;
    };
    let source;
    let currentStamp;
    try { source = resolve(state); currentStamp = getStamp(source); }
    catch (error) { return finish('waiting-for-app', { error: error.message }); }
    if (previous.rejectedStamp === currentStamp && previous.rejectedRevision === store.PATCH_REVISION) {
      return { status: 'rejected-until-next-update' };
    }
    if (previous.retryStamp === currentStamp && previous.retryAt > now()) return { status: 'retry-pending', retryAt: previous.retryAt };
    try {
      const active = store.checkedActive(state);
      if (active) repairShortcuts(state, active.app);
      if (active?.revision === store.PATCH_REVISION && previous.successStamp === currentStamp && previous.activeId === active.id) {
        return { status: 'idle' };
      }
      stopped([source, active?.app]);
      const result = await install(source, state);
      if (!['installed', 'already-installed'].includes(result.status)) throw new Error(`Patch was not installed: ${result.status}`);
      return finish('installed', { result, activeId: store.checkedActive(state)?.id, successStamp: currentStamp,
        rejectedStamp: null, rejectedRevision: null, retryStamp: null, retryAt: null, failureCount: 0, error: null });
    } catch (error) {
      if (error.code === 'APP_RUNNING') return finish('waiting-for-exit', { error: null });
      if (['UNSUPPORTED_PATCH', 'UNSUPPORTED_UPDATER', 'UNSUPPORTED_INTEGRITY'].includes(error.code)) {
        return finish('failed', { error: error.message, rejectedStamp: currentStamp, rejectedRevision: store.PATCH_REVISION });
      }
      const failureCount = previous.retryStamp === currentStamp ? Math.min((previous.failureCount || 0) + 1, 6) : 1;
      return finish('failed', { error: error.message, code: error.code || null, rejectedStamp: null, rejectedRevision: null,
        retryStamp: currentStamp, failureCount, retryAt: now() + Math.min(30000 * 2 ** (failureCount - 1), 900000) });
    }
  });
}

function enable(state, source, { autoDiscover = true } = {}) {
  platform.requireWindows();
  platform.verify(source);
  store.assertSeparate(source, state);
  const { node, worker, script } = launcher.prepare(state);
  const legacyScript = path.join(state, 'agent/windows/native.ps1');
  const watchData = { node, worker, state };
  const config = { ...store.readOptional(store.configPath(state)), enabled: true, source, autoDiscover,
    workerId: crypto.randomUUID(), workerRevision: store.PATCH_REVISION, workerLayout: WORKER_LAYOUT, enabledAt: new Date().toISOString() };
  try {
    const service = platform.native('enable', { state, name: serviceName(state), script, legacyScript,
      watchPayload: Buffer.from(JSON.stringify(watchData)).toString('base64') });
    store.saveJson(store.configPath(state), config);
    store.saveJson(store.statusPath(state), { status: 'enabled' });
    platform.native('start-watch', watchData);
    return { status: 'enabled', source, ...service, appliesOnExit: true,
      nextStep: 'Use launchers/windows/Apply and Restart.cmd to apply now, then use launchers/windows/Open Codex Fast.cmd to open the local copy.' };
  } catch (error) {
    store.saveJson(store.configPath(state), { ...config, enabled: false });
    throw error;
  }
}
function disable(state) {
  const config = store.readOptional(store.configPath(state)) || {};
  store.saveJson(store.configPath(state), { ...config, enabled: false });
  platform.native('disable', { name: serviceName(state), script: path.join(state, 'agent/src/platforms/windows/native.ps1'),
    legacyScript: path.join(state, 'agent/windows/native.ps1') });
  return { status: 'disabled' };
}
async function watch(state, { intervalMs = 10000 } = {}) {
  const config = store.readOptional(store.configPath(state));
  if (!config?.enabled) return;
  // The second lock prevents duplicate Startup or manually launched monitors.
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await store.withLock(path.join(state, 'watcher'), async () => {
      while (true) {
        const current = store.readOptional(store.configPath(state));
        if (!current?.enabled || current.workerId !== config.workerId) return;
        try { await tick(state); }
        catch (error) {
          fs.appendFileSync(path.join(state, 'windows-monitor.log'), `${new Date().toISOString()} ${error.message}\n`);
        }
        await delay(intervalMs);
      }
    });
    if (result?.status !== 'busy') return;
    const current = store.readOptional(store.configPath(state));
    if (!current?.enabled || current.workerId !== config.workerId) return;
    await delay(intervalMs);
  }
}
module.exports = { WORKER_LAYOUT, stamp, serviceName, tick, enable, disable, watch };
