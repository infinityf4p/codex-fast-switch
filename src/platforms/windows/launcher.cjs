const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { copyRuntime } = require('../../core/runtime.cjs');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const identity = require('./identity.cjs');
const prepared = new Set();

function prepare(state) {
  const agent = path.join(state, 'agent');
  const runtime = { node: path.join(agent, 'node.exe'), worker: path.join(agent, 'src/platforms/windows/cli.cjs'),
    script: path.join(agent, 'src/platforms/windows/native.ps1'), state };
  if (prepared.has(path.resolve(state))) return runtime;
  fs.mkdirSync(agent, { recursive: true });
  if (!store.contained(fs.realpathSync(state), fs.realpathSync(agent))) throw new Error('The worker directory must stay inside the state directory.');
  copyRuntime(agent, 'win32');
  const node = path.join(agent, 'node.exe');
  platform.assertRuntime(process.execPath);
  if (!fs.existsSync(node)) store.copyApp(process.execPath, node);
  platform.assertRuntime(node);
  prepared.add(path.resolve(state));
  return runtime;
}

function configure(state, app, { maintenance = false } = {}) {
  const primary = path.resolve(state).toLowerCase() === path.resolve(platform.DEFAULT_STATE).toLowerCase();
  const suffix = primary ? '' :
    ' ' + crypto.createHash('sha256').update(path.resolve(state).toLowerCase()).digest('hex').slice(0, 8);
  const active = store.checkedActive(state);
  return platform.native('shortcuts', { ...prepare(state), binary: platform.binaryPath(app),
    source: active?.source, shortcutName: 'Codex Fast' + suffix, redirectOfficial: primary, maintenance });
}

function refresh(state, app) {
  if (!fs.existsSync(path.join(state, 'agent/src/platforms/windows/shortcuts.ps1'))) return null;
  return configure(state, app, { maintenance: true });
}

async function install(source, state, options, { register = identity.ensure, configureShortcuts = configure } = {}) {
  const previous = store.checkedActive(state);
  const result = await store.install(source, state, options);
  if (['installed', 'already-installed'].includes(result.status)) {
    try {
      register(result.app, result.source || source);
      configureShortcuts(state, result.app);
    } catch (error) {
      try { restorePrevious(state, previous, result.app); }
      catch (rollbackError) { error.message += ' ' + rollbackError.message; }
      throw error;
    }
  }
  return result;
}

// Callers recovering from activation must first confirm that every related app
// is stopped: the package identity can belong to only one generation at a time.
function restorePrevious(state, previous, installedApp) {
  const failures = [];
  try {
    if (previous) store.saveJson(store.activePath(state), previous);
    else if (fs.existsSync(store.activePath(state))) fs.unlinkSync(store.activePath(state));
  } catch (error) { failures.push(`Restoring the previous launch target failed: ${error.message}`); }
  try {
    if (previous && fs.existsSync(path.join(path.dirname(previous.app), 'AppxManifest.xml'))) {
      identity.registerExisting(previous.app);
    } else {
      identity.remove({ state, roots: [path.dirname(installedApp)] });
    }
  } catch (error) { failures.push(`Restoring the previous package identity failed: ${error.message}`); }
  if (failures.length) throw new Error(failures.join(' '));
}

const remove = state => platform.native('remove-shortcuts', { state });
module.exports = { prepare, configure, refresh, install, restorePrevious, remove };
