const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const launcher = require('./launcher.cjs');
const { sha256 } = require('../../core/archive.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const jobPath = state => path.join(state, 'windows-update.json');
const validProfile = value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f"]/u.test(value);

// Called under the installation lock. Only a confirmed Update + Quit creates
// this intent; ordinary exits and background patching must never reopen an app.
function recover(state, { now = Date.now, same = platform.same, verify = platform.verify,
  processes = platform.processes, open = platform.openApp, register = require('./identity.cjs').ensure,
  configure = launcher.configure } = {}) {
  const job = store.readOptional(jobPath(state));
  if (!['installing', 'reopening'].includes(job?.status) || !validProfile(job.reopen?.userData)) return null;
  const requestedAt = Date.parse(job.reopen.requestedAt);
  if (!Number.isFinite(requestedAt) || requestedAt > now() || now() - requestedAt > 30 * 60 * 1000) return null;
  const active = store.checkedActive(state);
  if (!active || active.phase !== 'installed' || active.revision > store.PATCH_REVISION ||
      active.id === job.fromId || !(Date.parse(active.installedAt) >= requestedAt)) return null;
  const save = extra => store.saveJson(jobPath(state), { ...job, ...extra, checkedAt: new Date(now()).toISOString() });
  try {
    const previous = recordFor(state, job.fromId);
    const running = processes([previous.app, active.app, active.source]);
    const activeBinary = platform.binaryPath(active.app).toLowerCase();
    if (running.some(item => item.path.toLowerCase() !== activeBinary)) {
      throw new Error('Another Codex app was opened before the update could reopen.');
    }
    const alreadyOpen = running.length > 0;
    if (!alreadyOpen) {
      if (!same(active.app, active.patched)) throw new Error('The updated copy changed before reopening.');
      verify(active.app, { patched: true });
      register(active.app, active.source);
      configure(state, active.app);
      save({ status: 'reopening', app: active.app });
      open(active.app, { userData: job.reopen.userData, env: job.reopen.environment });
    }
    save({ status: 'installed', app: active.app, version: active.version, build: active.build,
      reopen: null, recovered: true, error: null });
    return { status: 'installed', app: active.app, recovered: true, reopened: !alreadyOpen };
  } catch (error) {
    save({ status: 'failed', reopen: null, error: error.message });
    throw error;
  }
}

function recordFor(state, id) {
  if (!/^\d+-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid update generation.');
  const directory = path.join(path.resolve(state), 'versions', id);
  const record = store.readOptional(path.join(directory, 'record.json'));
  if (record?.patchId !== store.PATCH_ID || record.id !== id || record.phase !== 'installed' ||
      record.app !== path.join(directory, 'app') || !record.original || !record.patched ||
      !store.contained(fs.realpathSync(state), fs.realpathSync(record.app))) {
    throw new Error('The running copy has no valid installation record.');
  }
  if (record.revision > store.PATCH_REVISION) throw new Error('Run the newer Fast Switch installer to update this copy.');
  return record;
}

function hasSourceChanges(source, running, currentStamp) {
  if (running.sourceStamp === currentStamp) return false;
  const files = platform.identityFiles();
  let previous, current;
  try { previous = JSON.parse(running.sourceStamp); current = JSON.parse(currentStamp); } catch {}
  const valid = value => Array.isArray(value) && value.length === files.length + 1 && value[0] === source &&
    value.slice(1).every(stats => Array.isArray(stats) && stats.length === 3 && stats.every(Number.isFinite));
  if (!valid(previous) || !valid(current)) return !platform.same(source, running.original);
  // Runtime initialization can change file timestamps without changing the installed build.
  // Hash only files with changed metadata so polling does not reread every large binary.
  return files.some((file, index) => JSON.stringify(previous[index + 1]) !== JSON.stringify(current[index + 1]) &&
    sha256(fs.readFileSync(path.join(source, file))) !== running.original[file]);
}

function check(state, id, { resolve = store.resolveSource, metadata = platform.metadata, stamp = platform.stamp } = {}) {
  const running = recordFor(state, id);
  const source = resolve(state);
  const info = metadata(source);
  if (running.arch !== info.arch) throw new Error('The official app architecture changed. Run install.cmd again.');
  const available = running.source !== source || running.version !== info.version || running.build !== info.build ||
    running.revision !== store.PATCH_REVISION || hasSourceChanges(source, running, stamp(source));
  const job = store.readOptional(jobPath(state));
  return { available, version: info.version, build: info.build, source,
    failure: job?.status === 'failed' && job.fromId === id ? { id: job.id, error: job.error } : null };
}

function checkForUpdates(state, id, { force = false, localCheck = check,
  officialCheck = require('./store-catalog.cjs').check } = {}) {
  const local = localCheck(state, id);
  const official = officialCheck(state, local.source, { force });
  return { ...local, localAvailable: local.available, official,
    available: local.available || official.status === 'available' };
}

async function install(state, id, { ready, installCopy = launcher.install, resolve = store.resolveSource,
  verify = platform.verify, stopped = platform.assertStopped, same = platform.same, open = platform.openApp,
  preflight = store.doctor, stamp = platform.stamp, now = Date.now, wait = delay, timeoutMs = 120000 } = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const result = await store.withLock(state, async () => {
      const running = recordFor(state, id);
      const active = store.checkedActive(state);
      const source = resolve(state);
      verify(source);
      if (!same(running.app, running.patched)) throw new Error('The running copy changed. Run install.cmd again.');
      stopped([source]);
      const job = { id: crypto.randomUUID(), fromId: id, workerPid: process.pid, status: 'preparing', startedAt: new Date(now()).toISOString() };
      const save = extra => { Object.assign(job, extra, { checkedAt: new Date(now()).toISOString() }); store.saveJson(jobPath(state), job); };
      let userData;
      let exited = false;
      let latestSource = source;
      let activatingApp;
      try {
        save({});
        // Check compatibility while the user's app is still running. The helper
        // must not signal readiness (and allow quit) for an unsupported update.
        await preflight(source);
        save({ status: 'waiting-for-exit' });
        userData = await ready();
        if (!validProfile(userData)) {
          throw new Error('Invalid application profile directory.');
        }
        const quitDeadline = now() + timeoutMs;
        while (true) {
          try { stopped([source, running.app, active?.app]); exited = true; break; }
          catch (error) { if (error.code !== 'APP_RUNNING') throw error; }
          if (now() >= quitDeadline) throw Object.assign(new Error('Codex did not finish quitting. Retry the update after closing active tasks.'),
            { code: 'QUIT_TIMEOUT' });
          await wait(500);
        }
        latestSource = resolve(state);
        // Persist the user's restart request before publication. If this helper
        // is interrupted, the monitor can finish registration and activation.
        const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
          /^(SystemRoot|WINDIR|COMSPEC|ProgramFiles(?:\(x86\))?|ProgramW6432|PATH|PATHEXT|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|CODEX_HOME|CODEX_ELECTRON_USER_DATA_PATH|LANG|LC_ALL|OTEL_SDK_DISABLED)$/i.test(key)));
        save({ status: 'installing', reopen: { userData, environment, requestedAt: new Date(now()).toISOString() } });
        const installed = await installCopy(latestSource, state, { onPhase: phase => save({ status: 'installing', phase }) });
        if (!['installed', 'already-installed'].includes(installed.status)) throw new Error('The updated copy was not installed.');
        stopped([latestSource, running.app]);
        save({ status: 'reopening', app: installed.app });
        activatingApp = installed.app;
        open(installed.app, { userData });
        activatingApp = null;
        save({ status: 'installed', app: installed.app, version: installed.version, build: installed.build, reopen: null, error: null });
        store.saveJson(store.statusPath(state), { status: 'installed', activeId: store.checkedActive(state)?.id,
          successStamp: stamp(latestSource), checkedAt: new Date(now()).toISOString(), error: null });
        return installed;
      } catch (error) {
        try { save({ status: 'failed', reopen: null, error: error.message, code: error.code || null }); }
        catch (recordError) { error.message += ' Could not record failure: ' + recordError.message; }
        if (exited) {
          try {
            stopped([source, latestSource, running.app, active?.app, activatingApp, store.checkedActive(state)?.app]);
            const previous = activatingApp ? active : running;
            if (!previous || same(previous.app, previous.patched)) {
              if (activatingApp) launcher.restorePrevious(state, active, activatingApp);
              open(previous?.app || source, { userData });
            }
          } catch (reopenError) {
            error.message += ' Could not reopen the previous copy: ' + reopenError.message;
            try { save({ reopenError: reopenError.message }); } catch {}
          }
        }
        throw error;
      }
    });
    if (result.status !== 'busy') return result;
    if (now() >= deadline) throw new Error('Another Fast Switch operation is still running. Retry shortly.');
    await wait(500);
  }
}

module.exports = { check, checkForUpdates, install, recover, recordFor, jobPath };
