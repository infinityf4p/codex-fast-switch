const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const { version, release } = require('./official-release.cjs');
const statusPath = state => path.join(state, 'windows-official-update.json');

function run(payload, onProgress, { start = spawn, timeoutMs = 45 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = start(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'official-update.ps1'), '-Payload', Buffer.from(JSON.stringify(payload)).toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', errors = '', result, failure;
    const timer = setTimeout(() => { failure = new Error('The official update timed out. Retry the update.'); child.kill(); }, timeoutMs);
    const accept = line => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/, ''));
        if (message.error) failure = new Error(message.error);
        else if (message.result) result = message.result;
        else if (['downloading', 'installing-official', 'awaiting-elevation'].includes(message.phase)) onProgress(message);
      } catch (error) { failure = error; }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', bytes => {
      buffer += bytes;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (buffer.length > 65536) { failure = new Error('Invalid official installer output.'); child.kill(); }
    });
    child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-4096); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); accept(buffer);
      if (failure || code !== 0 || !result) reject(failure || new Error(errors.trim() || 'The official installer did not complete.'));
      else resolve(result);
    });
  });
}

async function install(state, source, { native = platform.native, realpath = fs.realpathSync,
  execute = run, onProgress = () => {} } = {}) {
  const context = native('store-context');
  const installed = context.packages.find(item => {
    try { return realpath(item.app).toLowerCase() === realpath(source).toLowerCase(); } catch { return false; }
  });
  if (!installed) throw new Error('Automatic official updates require the registered production app.');
  const target = release(native('official-feed'), installed.arch);
  if (version(target.version) <= version(installed.version)) return { status: 'current', version: installed.version };
  const progress = value => onProgress({ ...value, targetVersion: target.version });
  const result = await execute({ ...target, state: path.resolve(state), installedVersion: installed.version }, progress);
  // The external installer result alone is insufficient: confirm Windows' registration.
  const registered = native('store-context').packages.find(item => item.arch === installed.arch &&
    version(item.version) >= version(target.version));
  if (!registered || result.status !== 'installed') throw new Error('Windows has not registered the downloaded official update.');
  return { status: 'installed', version: registered.version, source: realpath(registered.app) };
}

async function update(state, id, { installOfficial = install, resolve = store.resolveSource,
  stopped = platform.assertStopped, now = Date.now, wait = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const deadline = now() + 30000;
  while (true) {
    const result = await store.withLock(state, async () => {
      require('./updates.cjs').recordFor(state, id);
      const source = resolve(state);
      // Never close a running official window while preparing the independent copy.
      stopped([source]);
      const save = extra => store.saveJson(statusPath(state), { id, checkedAt: now(), ...extra });
      save({ phase: 'checking-official' });
      try {
        const updated = await installOfficial(state, source, { onProgress: save });
        // A registered MSIX moves to a versioned directory after deployment,
        // including when the user originally selected that package with --app.
        const config = store.readOptional(store.configPath(state));
        if (updated.source && config) store.saveJson(store.configPath(state), { ...config, source: updated.source });
        save({ phase: 'complete', result: updated });
        return updated;
      } catch (error) { save({ phase: 'failed', error: error.message }); throw error; }
    });
    if (result.status !== 'busy') return result;
    if (now() >= deadline) throw new Error('Another Fast Switch operation is still running. Retry shortly.');
    await wait(250);
  }
}

module.exports = { install, update, run, statusPath };
