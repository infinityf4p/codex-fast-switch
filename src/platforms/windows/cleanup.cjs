const fs = require('node:fs');
const path = require('node:path');
const store = require('./store.cjs');
const platform = require('./platform.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const files = new Set(['windows.json', 'windows-active.json', 'windows-status.json', 'windows-monitor.log']);
const directories = new Set(['versions', 'agent', 'watcher', 'automatic.lock']);

function checkedPath(state, target) {
  const info = fs.lstatSync(target);
  if (info.isSymbolicLink() || !store.contained(fs.realpathSync(state), fs.realpathSync(target))) {
    throw new Error(`Refusing to clean a redirected installation path: ${target}`);
  }
  return info;
}

function plan(state) {
  state = path.resolve(state);
  if (state === path.parse(state).root || fs.lstatSync(state).isSymbolicLink()) {
    throw new Error('The uninstall state must be a regular installation directory.');
  }
  if (store.contained(fs.realpathSync(state), fs.realpathSync(process.execPath))) {
    throw new Error('Run uninstall.cmd so cleanup uses a temporary Node runtime outside the installation.');
  }
  const targets = [...files].map(name => path.join(state, name));
  for (const name of fs.readdirSync(state)) {
    const target = path.join(state, name);
    const info = checkedPath(state, target);
    const temporaryRecord = /^windows(?:-active|-status)?\.json\.[a-f0-9-]{36}\.tmp$/.test(name);
    if (!((files.has(name) || temporaryRecord) && info.isFile()) && !(directories.has(name) && info.isDirectory())) {
      throw new Error(`The state directory contains an unrecognized item; it will not be deleted: ${target}`);
    }
    if (!['automatic.lock', 'watcher'].includes(name) && !targets.includes(target)) targets.push(target);
  }
  const apps = [];
  const versions = path.join(state, 'versions');
  if (fs.existsSync(versions)) {
    for (const id of fs.readdirSync(versions)) {
      const directory = path.join(versions, id);
      if (!/^\d+-[a-f0-9-]{36}$/.test(id) || !checkedPath(state, directory).isDirectory()) {
        throw new Error(`Unrecognized installation generation: ${directory}`);
      }
      const journal = path.join(directory, 'record.json');
      if (!fs.existsSync(journal) && fs.readdirSync(directory).every(name =>
        /^record\.json\.[a-f0-9-]{36}\.tmp$/.test(name) && checkedPath(state, path.join(directory, name)).isFile())) continue;
      checkedPath(state, journal);
      const record = store.readOptional(journal);
      const app = path.join(directory, 'app');
      if (record?.patchId !== store.PATCH_ID || record.id !== id || record.app !== app) {
        throw new Error(`Invalid installation generation record: ${journal}`);
      }
      if (fs.existsSync(app)) {
        if (!checkedPath(state, app).isDirectory()) throw new Error(`Invalid local app directory: ${app}`);
        if (fs.existsSync(platform.binaryPath(app))) apps.push(app);
      }
    }
  }
  const watcher = path.join(state, 'watcher');
  if (fs.existsSync(watcher) && fs.readdirSync(watcher).some(name => name !== 'automatic.lock')) {
    throw new Error('The watcher directory contains unrecognized files; it will not be deleted.');
  }
  return { state, realState: fs.realpathSync(state), targets, apps };
}

function workerRunning(state) {
  const binary = path.join(state, 'agent', 'node.exe');
  if (!fs.existsSync(binary)) return false;
  const expected = fs.realpathSync(binary).toLowerCase();
  return platform.native('processes', { binaries: [binary] }).some(item => {
    try { return fs.realpathSync(item.path).toLowerCase() === expected; }
    catch { return false; }
  });
}

async function remove(prepared, { onPhase = () => {}, timeoutMs = 30000 } = {}) {
  const { state, realState, targets, apps } = prepared;
  const watcher = path.join(state, 'watcher');
  const deadline = Date.now() + timeoutMs;
  onPhase('waiting-for-monitor');
  while (true) {
    if (workerRunning(state)) {
      if (Date.now() >= deadline) throw new Error('The background monitor has not exited. Retry uninstall.cmd shortly.');
      await delay(500);
      continue;
    }
    const result = await store.withLock(watcher, () => {
      if (fs.realpathSync(state) !== realState) throw new Error('The installation directory changed during uninstall.');
      platform.assertStopped(apps);
      // Hold both installer and watcher locks while removing owned installation files.
      onPhase('removing-installation');
      for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        checkedPath(state, target);
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
      return { status: 'cleaned' };
    });
    if (result.status === 'cleaned') break;
    if (Date.now() >= deadline) throw new Error('The background monitor has not exited. Retry uninstall.cmd shortly.');
    await delay(500);
  }
  fs.rmdirSync(watcher);
}

module.exports = { plan, remove };
