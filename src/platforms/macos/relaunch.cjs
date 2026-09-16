const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tx = require('./transaction.cjs');
const automatic = require('./automatic.cjs');
const { isRunning, sparkleBusy, openApp } = require('./platform.cjs');
const pending = record => ['prepared', 'activated', 'rollback-pending'].includes(record?.phase);
const optional = file => fs.existsSync(file) ? tx.readJson(file) : {};

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function relaunch(state, app, { tick = automatic.tick, lock = tx.withLock,
  running = isRunning, updaterBusy = sparkleBusy, open = openApp,
  appPresent = app => fs.existsSync(path.join(app, 'Contents/Info.plist')),
  record = tx.checkedRecord, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  parentPid, parentAlive = alive,
  timeoutMs = 120000, notify = message => execFileSync(path.join(__dirname, '../../../build/macos/native-helper'),
    ['notify', message], { stdio: 'ignore', timeout: 35000 }) } = {}) {
  state = path.resolve(state);
  app = path.resolve(app);
  const start = now();
  const messages = [];
  let result;
  // The updater only suppresses its own reopen after this independent worker acknowledges startup.
  while (parentPid && parentAlive(parentPid)) {
    if (now() - start >= timeoutMs) return { status: 'quit-cancelled', milliseconds: now() - start };
    await wait(250);
  }
  while (true) {
    const config = optional(automatic.configPath(state));
    if (config.app && config.app !== app) throw new Error('The update handoff belongs to a different app.');
    // Sparkle can temporarily remove the bundle while replacing it.
    if (!updaterBusy(app) && appPresent(app)) {
      if (running(app)) return { status: 'already-open', milliseconds: now() - start };
      result = await tick(state, { notifyUser: message => messages.push(message),
        restartApp: async () => { throw Object.assign(new Error('The app was opened during update preparation.'), { code: 'APP_RUNNING' }); } });
      if (!['busy', 'waiting-for-update', 'waiting-for-app', 'waiting-for-exit'].includes(result.status)) {
        const opened = await lock(state, () => {
          if (updaterBusy(app)) return { status: 'waiting-for-update' };
          if (pending(record(state, app))) throw new Error('Update recovery is pending. The app was not opened.');
          if (!running(app)) open(app);
          return { status: 'opened' };
        });
        if (opened.status === 'opened') break;
      }
    }
    if (now() - start >= timeoutMs) throw new Error('The official updater or another patch operation has not finished.');
    await wait(250);
  }
  // Error dialogs must not delay reopening a compatible original after a rejected patch.
  for (const message of messages) try { notify(message); } catch {}
  return { status: 'reopened', patch: result.status, milliseconds: now() - start };
}

module.exports = { relaunch };
if (require.main === module) {
  const [state, app, parent] = process.argv.slice(2);
  let acknowledged = false;
  Promise.resolve().then(() => {
    const parentPid = Number(parent);
    const config = state && optional(automatic.configPath(state));
    if (!state || !app || !Number.isSafeInteger(parentPid) || parentPid <= 1 || !config.enabled || config.app !== app) {
      throw new Error('Invalid update handoff.');
    }
    process.stdout.write('ready');
    acknowledged = true;
    return relaunch(state, app, { parentPid });
  }).then(result => console.error(JSON.stringify(result)))
    .catch(error => {
      console.error(error.message);
      if (acknowledged) try {
        execFileSync(path.join(__dirname, '../../../build/macos/native-helper'), ['notify',
          `Fast update preparation could not finish. Check update-relaunch.log in the Codex Fast Switch state directory.\n\n${error.message}`],
        { stdio: 'ignore', timeout: 35000 });
      } catch {}
      process.exitCode = 1;
    });
}
