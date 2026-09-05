const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const transaction = require('./lib/transaction.cjs');
const { restart: performRestart } = require('./lib/restart.cjs');
const { assertStopped, identityFiles, discoverApp, requireMac, assertRuntime } = require('./lib/platform.cjs');
const { DEFAULT_STATE, saveJson, readJson, withLock, marker, PATCH_ID } = transaction;
const LABEL = 'io.github.infinityf4p.codex-fast-switch';
const service = () => `gui/${process.getuid()}/${LABEL}`;
function strayRestartLabels(labels) {
  const prefix = `${LABEL}.restart-now`;
  return labels.filter(label => label === prefix || label.startsWith(`${prefix}-`));
}
function guiLabels() {
  return execFileSync('/bin/launchctl', ['list'], { encoding: 'utf8' }).split('\n')
    .map(line => line.trim().split(/\s+/).pop()).filter(label => label && label !== 'Label');
}
function stopStrayRestartJobs() {
  if (process.platform !== 'darwin') return [];
  const stopped = [];
  try {
    for (const label of strayRestartLabels(guiLabels())) {
      try {
        execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'pipe' });
        stopped.push(label);
      } catch {}
    }
  } catch {}
  return stopped;
}
const configPath = state => path.join(state, 'automatic.json');
const statusPath = state => path.join(state, 'automatic-status.json');
const readOptional = file => fs.existsSync(file) ? readJson(file) : {};
function stamp(app) {
  return identityFiles(app).map(file => {
    const stat = fs.statSync(path.join(app, file));
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
  });
}
function notify(message) {
  execFileSync(path.join(__dirname, 'lib/native-helper'), ['notify', message], { stdio: 'ignore', timeout: 35000 });
}
async function tick(state = DEFAULT_STATE, { now = Date.now(), install = transaction.install, recover = transaction.recover,
  stopped = assertStopped, notifyUser = notify, getStamp = stamp } = {}) {
  state = path.resolve(state);
  return withLock(state, async () => {
    const config = readOptional(configPath(state));
    if (!config.enabled) return { status: 'disabled' };
    const app = config.app;
    const previous = readOptional(statusPath(state));
    const finish = (status, extra = {}) => {
      const value = { ...previous, status, checkedAt: new Date(now).toISOString(), ...extra };
      saveJson(statusPath(state), value);
      return value;
    };
    if (!fs.existsSync(app)) return finish('waiting-for-app');
    let currentStamp;
    try { currentStamp = JSON.stringify(getStamp(app)); } catch { return finish('waiting-for-update'); }
    if (previous.successStamp === currentStamp) return { status: 'idle' };
    let record;
    try { record = transaction.checkedRecord(state, app); }
    catch (error) {
      const result = finish('recovery-record-error', { error: error.message, rejectedStamp: currentStamp });
      if (previous.error !== error.message || previous.rejectedStamp !== currentStamp) {
        try { notifyUser(`Fast patch recovery needs attention. The app was not replaced.\n\n${error.message}`); } catch {}
      }
      return result;
    }
    const pendingRecovery = ['prepared', 'activated', 'rollback-pending'].includes(record?.phase);
    if (!pendingRecovery && previous.rejectedStamp === currentStamp) return { status: 'rejected-until-next-update' };
    try { stopped(app); } catch (error) {
      if (error.code === 'APP_RUNNING') return finish('waiting-for-exit');
      return finish('process-check-failed', { error: error.message });
    }
    try {
      if (pendingRecovery) {
        const result = recover(app, state);
        const restoredStamp = JSON.stringify(getStamp(app));
        finish('recovered', { result, rejectedStamp: restoredStamp });
        try { notifyUser('An interrupted Fast patch was rolled back. The unmodified app for that version is available. Automatic retries are paused until the next update.'); } catch {}
        return { status: 'recovered', result };
      }
      const result = await install(app, state, { model: config.model });
      if (!['installed', 'already-installed'].includes(result.status)) throw new Error(`Patch was not activated: ${result.status}`);
      return finish('installed', { result, successStamp: JSON.stringify(getStamp(app)), rejectedStamp: null, error: null });
    } catch (error) {
      if (error.code === 'APP_RUNNING') return finish('waiting-for-exit');
      let failedStamp = currentStamp;
      try { failedStamp = JSON.stringify(getStamp(app)); } catch {}
      let pending = false;
      try { pending = transaction.checkedRecord(state, app)?.phase === 'rollback-pending'; } catch {}
      const result = finish(pending ? 'rollback-pending' : 'failed', { error: error.message, rejectedStamp: pending ? null : failedStamp });
      try {
        notifyUser(pending ? `Fast patch could not complete. Quit the app so recovery can finish.\n\n${error.message}` :
          `Fast could not be enabled for this version. The app update has been preserved or restored. This build will not be retried automatically.\n\n${error.message}`);
      } catch (notificationError) {
        result.notificationError = notificationError.message;
        saveJson(statusPath(state), result);
      }
      return result;
    }
  });
}

const servicePlist = () => path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
function assertServiceOwner(state) {
  if (!fs.existsSync(servicePlist())) return;
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', servicePlist()], { encoding: 'utf8' }));
  if (plist.ProgramArguments?.at(-1) !== path.resolve(state)) throw new Error('The automatic service belongs to a different --state directory. Disable it using that directory first.');
}
function stopService(state) {
  assertServiceOwner(state);
  try { execFileSync('/bin/launchctl', ['print', service()], { stdio: 'ignore' }); }
  catch { return; }
  execFileSync('/bin/launchctl', ['bootout', service()], { stdio: 'pipe' });
}
function plistDefinition(node, worker, state) {
  return { Label: LABEL, ProgramArguments: [node, worker, 'watch', state], RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false }, ThrottleInterval: 10,
    ProcessType: 'Background', LowPriorityIO: true, LimitLoadToSessionType: 'Aqua',
    StandardOutPath: path.join(state, 'automatic.log'), StandardErrorPath: path.join(state, 'automatic-error.log'),
    EnvironmentVariables: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } };
}
async function enable(state = DEFAULT_STATE, app = discoverApp(), { model } = {}) {
  requireMac();
  state = path.resolve(state);
  app = fs.realpathSync(app);
  const previous = readOptional(configPath(state));
  if (previous.app && previous.app !== app) throw new Error('Restore the previous app before selecting another app with a fresh --state directory.');
  const current = marker(app);
  if (current && current.patchId !== PATCH_ID) throw new Error('Restore the earlier fixed-version patch before enabling automatic patching.');
  if (!current) transaction.verify(app, true);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  return withLock(state, () => installAgent(state, app, model));
}
function installAgent(state, app, model) {
  stopStrayRestartJobs();
  stopService(state);
  const agent = path.join(state, 'agent');
  const staged = path.join(state, `.agent-${crypto.randomUUID()}`);
  fs.mkdirSync(staged, { mode: 0o700 });
  try {
    for (const item of ['automatic.cjs', 'cli.cjs', 'watch.cjs', 'lib', 'node_modules', 'package.json', 'package-lock.json', 'README.md', 'LICENSE']) {
      fs.cpSync(path.join(__dirname, item), path.join(staged, item), { recursive: true, verbatimSymlinks: true });
    }
    fs.mkdirSync(path.join(staged, 'runtime'));
    const bundledNode = path.join(app, 'Contents/Resources/cua_node/bin/node');
    const runtime = assertRuntime(fs.existsSync(bundledNode) ? bundledNode : process.execPath);
    fs.copyFileSync(runtime, path.join(staged, 'runtime/node'));
    fs.chmodSync(path.join(staged, 'runtime/node'), 0o755);
    assertRuntime(path.join(staged, 'runtime/node'));
    execFileSync(path.join(staged, 'runtime/node'), ['--check', path.join(staged, 'automatic.cjs')]);
    if (fs.existsSync(agent)) fs.renameSync(agent, path.join(state, `previous-agent-${Date.now()}`));
    fs.renameSync(staged, agent);
    const dir = path.join(os.homedir(), 'Library/LaunchAgents');
    fs.mkdirSync(dir, { recursive: true });
    const plist = servicePlist();
    saveJson(plist, plistDefinition(path.join(agent, 'runtime/node'), path.join(agent, 'automatic.cjs'), state));
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
    execFileSync('/usr/bin/plutil', ['-lint', plist]);
    saveJson(configPath(state), { enabled: true, app, model, enabledAt: new Date().toISOString() });
    if (fs.existsSync(statusPath(state))) fs.rmSync(statusPath(state));
    execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
    return { status: 'enabled', app, appliesOnExit: true,
      nextStep: 'Run Apply and Restart.command to apply now and reopen the app automatically.' };
  } catch (error) {
    saveJson(configPath(state), { enabled: false, app, error: error.message });
    throw error;
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
}
function disableUnlocked(state) {
  requireMac();
  state = path.resolve(state);
  assertServiceOwner(state);
  const config = readOptional(configPath(state));
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  saveJson(configPath(state), { ...config, enabled: false });
  stopStrayRestartJobs();
  stopService(state);
  const plist = servicePlist();
  if (fs.existsSync(plist)) fs.rmSync(plist);
  return { status: 'disabled' };
}
async function disable(state = DEFAULT_STATE) {
  requireMac();
  return withLock(path.resolve(state), () => disableUnlocked(state));
}
function status(state = DEFAULT_STATE) {
  return { configuration: readOptional(configPath(state)), lastCheck: readOptional(statusPath(state)),
    transaction: readOptional(transaction.recordPath(state)) };
}
async function restart(state = DEFAULT_STATE, app = discoverApp(), options = {}) {
  stopStrayRestartJobs();
  return withLock(state, async () => {
    const onPhase = phase => {
      saveJson(statusPath(state), { status: 'restarting', phase, checkedAt: new Date().toISOString() });
      options.onPhase?.(phase);
    };
    try {
      const result = await performRestart(app, state, { ...options, onPhase });
      saveJson(statusPath(state), { status: 'installed', checkedAt: new Date().toISOString(),
        successStamp: JSON.stringify(stamp(app)), result });
      return result;
    } catch (error) {
      let rejectedStamp;
      const waitingForExit = ['QUIT_TIMEOUT', 'APP_RUNNING'].includes(error.code);
      if (!waitingForExit) try { rejectedStamp = JSON.stringify(stamp(app)); } catch {}
      saveJson(statusPath(state), { status: waitingForExit ? 'waiting-for-exit' : 'failed', checkedAt: new Date().toISOString(),
        error: error.message, rejectedStamp, reopenedAfterFailure: error.reopenedAfterFailure });
      throw error;
    }
  });
}
async function restore(state = DEFAULT_STATE, app = discoverApp()) {
  return withLock(state, async () => {
    disableUnlocked(state);
    if (!marker(app) && !fs.existsSync(transaction.recordPath(state))) return { status: 'already-original' };
    return transaction.restore(app, state);
  });
}
module.exports = { tick, enable, disable, restore, status, stamp, configPath, statusPath, plistDefinition,
  restart, strayRestartLabels, stopStrayRestartJobs };
if (require.main === module) {
  const [command = 'status', state = DEFAULT_STATE] = process.argv.slice(2);
  Promise.resolve().then(() => {
    requireMac();
    if (command === 'watch') return require('./watch.cjs').watch(state);
    if (command === 'tick') return tick(state);
    throw new Error('Use cli.cjs for interactive commands.');
  }).then(result => { if (command !== 'tick') console.log(JSON.stringify(result, null, 2)); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
