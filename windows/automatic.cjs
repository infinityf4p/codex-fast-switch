const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = app => JSON.stringify([app, ...platform.identityFiles().map(file => {
  const stat = fs.statSync(path.join(app, file));
  return [stat.size, stat.mtimeMs, stat.ctimeMs];
})]);
const serviceName = state => `Codex Fast Switch ${crypto.createHash('sha256').update(path.resolve(state).toLowerCase()).digest('hex').slice(0, 12)}`;

async function tick(state, { resolve = store.resolveSource, stopped = platform.assertStopped,
  install = store.install, getStamp = stamp } = {}) {
  return store.withLock(state, async () => {
    const config = store.readOptional(store.configPath(state));
    if (!config?.enabled) return { status: 'disabled' };
    const previous = store.readOptional(store.statusPath(state)) || {};
    const finish = (status, extra = {}) => {
      const result = { ...previous, status, checkedAt: new Date().toISOString(), ...extra };
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
    try {
      const active = store.checkedActive(state);
      if (active?.revision === store.PATCH_REVISION && previous.successStamp === currentStamp && previous.activeId === active.id) {
        return { status: 'idle' };
      }
      stopped([source, active?.app]);
      const result = await install(source, state);
      if (!['installed', 'already-installed'].includes(result.status)) throw new Error(`Patch was not installed: ${result.status}`);
      return finish('installed', { result, activeId: store.checkedActive(state)?.id, successStamp: currentStamp,
        rejectedStamp: null, rejectedRevision: null, error: null });
    } catch (error) {
      if (error.code === 'APP_RUNNING') return finish('waiting-for-exit', { error: null });
      return finish('failed', { error: error.message, rejectedStamp: currentStamp, rejectedRevision: store.PATCH_REVISION });
    }
  });
}

function enable(state, source, { autoDiscover = true } = {}) {
  platform.requireWindows();
  platform.verify(source);
  store.assertSeparate(source, state);
  const agent = path.join(state, 'agent');
  fs.mkdirSync(agent, { recursive: true });
  if (!store.contained(fs.realpathSync(state), fs.realpathSync(agent))) throw new Error('The worker directory must stay inside the state directory.');
  const root = path.join(__dirname, '..');
  for (const item of ['windows', 'lib', 'node_modules', 'package.json', 'package-lock.json', 'LICENSE']) {
    if (fs.realpathSync(root) !== fs.realpathSync(agent)) fs.cpSync(path.join(root, item), path.join(agent, item), { recursive: true });
  }
  const node = path.join(agent, 'node.exe');
  platform.assertRuntime(process.execPath);
  if (!fs.existsSync(node)) store.copyApp(process.execPath, node);
  platform.assertRuntime(node);
  const worker = path.join(agent, 'windows/cli.cjs');
  const script = path.join(agent, 'windows/native.ps1');
  const watchData = { node, worker, state };
  const config = { ...store.readOptional(store.configPath(state)), enabled: true, source, autoDiscover,
    workerId: crypto.randomUUID(), workerRevision: store.PATCH_REVISION, enabledAt: new Date().toISOString() };
  try {
    const service = platform.native('enable', { state, name: serviceName(state), script,
      watchPayload: Buffer.from(JSON.stringify(watchData)).toString('base64') });
    store.saveJson(store.configPath(state), config);
    store.saveJson(store.statusPath(state), { status: 'enabled' });
    platform.native('start-watch', watchData);
    return { status: 'enabled', source, ...service, appliesOnExit: true,
      nextStep: 'Use Apply and Restart.cmd to apply now, then use Open Codex Fast.cmd to open the local copy.' };
  } catch (error) {
    store.saveJson(store.configPath(state), { ...config, enabled: false });
    throw error;
  }
}
function disable(state) {
  const config = store.readOptional(store.configPath(state)) || {};
  store.saveJson(store.configPath(state), { ...config, enabled: false });
  platform.native('disable', { name: serviceName(state), script: path.join(state, 'agent/windows/native.ps1') });
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
module.exports = { stamp, serviceName, tick, enable, disable, watch };
