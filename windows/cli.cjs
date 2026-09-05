const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const automatic = require('./automatic.cjs');
const cleanup = require('./cleanup.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function quitAndWait(apps, { onPhase = () => {}, timeoutMs = 30000,
  processes = platform.processes, quit = platform.requestQuit, now = Date.now, wait = delay } = {}) {
  const running = processes(apps);
  if (running.length) {
    onPhase('requesting-quit');
    quit(apps);
    const deadline = now() + timeoutMs;
    while (processes(apps).length) {
      if (now() >= deadline) throw Object.assign(new Error('Codex did not exit. Open Codex and press Ctrl+Q (or choose Quit in the tray menu), then retry. Closing its window may keep it running in the tray.'), { code: 'QUIT_TIMEOUT' });
      await wait(500);
    }
  }
  return running;
}

async function launch(state, source, { restart = false, onPhase = () => {}, timeoutMs = 30000,
  processes = platform.processes, quit = platform.requestQuit, open = platform.openApp, install = store.install,
  now = Date.now, wait = delay, same = platform.same, verify = platform.verify } = {}) {
  const active = store.checkedActive(state);
  const apps = [source, active?.app];
  if (!restart) {
    if (!active) throw new Error('No local copy is installed. Run install.cmd first.');
    if (!same(active.app, active.patched)) throw new Error('The local copy has changed. Restore it before applying again.');
    verify(active.app, { patched: true });
    if (processes([source]).length) throw Object.assign(new Error('The original app is running. Exit it or use Apply and Restart.cmd.'), { code: 'APP_RUNNING' });
    if (!processes([active.app]).length) open(active.app);
    return { status: 'opened', app: active.app };
  }
  const running = await quitAndWait(apps, { onPhase, timeoutMs, processes, quit, now, wait });
  const previousApp = running.some(item => item.path.toLowerCase() === platform.binaryPath(active?.app || source).toLowerCase()) && active ? active.app : source;
  try {
    const result = await install(source, state, { onPhase });
    if (!['installed', 'already-installed'].includes(result.status)) throw new Error(`Patch was not installed: ${result.status}`);
    if (processes(apps).length) throw Object.assign(new Error('Codex was reopened while preparing the copy. Close it, then use Open Codex Fast.cmd.'), { code: 'APP_RUNNING' });
    onPhase('reopening');
    open(result.app);
    return { ...result, reopened: true };
  } catch (error) {
    if (running.length) {
      try {
        if (!processes(apps).length && (previousApp === source || same(active.app, active.patched))) open(previousApp);
      } catch (openError) { error.message += ` Reopen failed: ${openError.message}`; }
    }
    throw error;
  }
}

async function uninstall(state, { onPhase = () => {} } = {}) {
  const prepared = cleanup.plan(state);
  if (prepared.apps.length) await quitAndWait(prepared.apps, { onPhase });
  onPhase('disabling-monitor');
  automatic.disable(state);
  onPhase('restoring-original');
  const result = { status: 'uninstalled', originalUnchanged: true, reopened: false,
    nextStep: 'Open the original Codex / ChatGPT app from the Start menu.' };
  try {
    const source = store.resolveSource(state);
    platform.verify(source);
    if (!platform.processes([source]).length) {
      onPhase('reopening-original');
      platform.openApp(source);
      result.reopened = true;
    }
    result.app = source;
    delete result.nextStep;
  } catch (error) {
    result.reopenError = error.message;
  }
  await cleanup.remove(prepared, { onPhase });
  result.cleaned = true;
  return result;
}

async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    app: { type: 'string' }, state: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Codex Fast Switch for Windows\n\nnode cli.cjs <setup|uninstall|doctor|install|restart|launch|enable|disable|restore|status> [--app PATH] [--state PATH]\n\ninstall.cmd installs or updates the local Fast copy and automatic monitoring, then opens Codex.\nuninstall.cmd quits local copies, removes automatic monitoring and all Fast Switch installation files, then returns to the original app.\nCodex personal settings and conversations are preserved.');
    return;
  }
  platform.requireWindows();
  const [command = 'status'] = positionals;
  if (positionals.length > 1 || !['setup', 'uninstall', 'doctor', 'install', 'restart', 'launch', 'enable', 'disable', 'restore', 'status', 'watch', 'tick'].includes(command)) {
    throw new Error('Unknown command. Run node cli.cjs --help.');
  }
  const state = path.resolve(values.state || platform.DEFAULT_STATE);
  if (command === 'status') return store.status(state);
  if (command === 'watch') return automatic.watch(state);
  if (command === 'tick') return automatic.tick(state);
  if (command === 'disable') return store.withLock(state, () => automatic.disable(state));
  if (command === 'restore') return store.withLock(state, () => { automatic.disable(state); return store.restore(state); });
  const source = command === 'uninstall' ? null : store.resolveSource(state, values.app);
  if (command === 'doctor') return store.doctor(source);
  let lastPhase = 'starting';
  const onPhase = phase => { lastPhase = phase; console.error(`Patch: ${phase}`); };
  const operation = await store.withLock(state, async () => {
    try {
      if (command === 'uninstall') {
        return await uninstall(state, { onPhase });
      }
      const previous = store.readOptional(store.configPath(state));
      const autoDiscover = values.app ? false : previous?.autoDiscover !== false;
      if (command === 'enable') return automatic.enable(state, source, { autoDiscover });
      let result;
      if (command === 'setup') {
        const active = store.checkedActive(state);
        const current = active?.revision === store.PATCH_REVISION && active.source === source &&
          platform.same(source, active.original) && platform.same(active.app, active.patched) && !platform.processes([source]).length;
        result = await launch(state, source, { restart: !current, onPhase });
      } else if (command === 'launch' || command === 'restart') result = await launch(state, source, { restart: command === 'restart', onPhase });
      else result = await store.install(source, state, { onPhase });
      store.saveJson(store.configPath(state), { ...previous, source, autoDiscover });
      if (command === 'setup' || (['installed', 'already-installed'].includes(result.status) && previous?.enabled && previous.workerRevision !== store.PATCH_REVISION)) {
        onPhase('updating-monitor');
        result = { ...result, automatic: automatic.enable(state, source, { autoDiscover }) };
      }
      store.saveJson(store.statusPath(state), { ...result, checkedAt: new Date().toISOString() });
      return result;
    } catch (error) {
      try {
        store.saveJson(store.statusPath(state), { status: 'failed', phase: lastPhase, code: error.code || null,
          message: error.message, checkedAt: new Date().toISOString() });
      } catch (logError) { error.message += ` Could not save failure details: ${logError.message}`; }
      throw error;
    }
  });
  if (command === 'uninstall' && operation?.cleaned) {
    try { fs.rmdirSync(state); operation.stateRemoved = true; }
    catch (error) {
      if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
      operation.stateRemoved = false;
      operation.message = 'Fast Switch files were removed, but another operation added files to the state directory.';
    }
  }
  return operation;
}
if (require.main === module) main().then(result => {
  if (result) console.log(JSON.stringify(result, null, 2));
  if (result?.status === 'busy') process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, launch, uninstall };
