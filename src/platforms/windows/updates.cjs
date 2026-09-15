const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const platform = require('./platform.cjs');
const store = require('./store.cjs');
const launcher = require('./launcher.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const jobPath = state => path.join(state, 'windows-update.json');

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

function check(state, id, { resolve = store.resolveSource, metadata = platform.metadata, stamp = platform.stamp } = {}) {
  const running = recordFor(state, id);
  const source = resolve(state);
  const info = metadata(source);
  if (running.arch !== info.arch) throw new Error('The official app architecture changed. Run install.cmd again.');
  const available = running.source !== source || running.version !== info.version || running.build !== info.build ||
    running.revision !== store.PATCH_REVISION || (running.sourceStamp != null && running.sourceStamp !== stamp(source));
  const job = store.readOptional(jobPath(state));
  return { available, version: info.version, build: info.build, source,
    failure: job?.status === 'failed' && job.fromId === id ? { id: job.id, error: job.error } : null };
}

async function install(state, id, { ready, installCopy = launcher.install, resolve = store.resolveSource,
  verify = platform.verify, stopped = platform.assertStopped, same = platform.same, open = platform.openApp,
  stamp = platform.stamp, now = Date.now, wait = delay, timeoutMs = 120000 } = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const result = await store.withLock(state, async () => {
      const running = recordFor(state, id);
      const active = store.checkedActive(state);
      const source = resolve(state);
      verify(source);
      if (!same(running.app, running.patched)) throw new Error('The running copy changed. Run install.cmd again.');
      stopped([source]);
      const job = { id: crypto.randomUUID(), fromId: id, status: 'waiting-for-exit', startedAt: new Date(now()).toISOString() };
      const save = extra => { Object.assign(job, extra, { checkedAt: new Date(now()).toISOString() }); store.saveJson(jobPath(state), job); };
      let userData;
      let exited = false;
      try {
        save({});
        userData = await ready();
        if (typeof userData !== 'string' || !path.isAbsolute(userData) || /[\x00-\x1f"]/u.test(userData)) {
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
        const latestSource = resolve(state);
        const installed = await installCopy(latestSource, state, { onPhase: phase => save({ status: 'installing', phase }) });
        if (!['installed', 'already-installed'].includes(installed.status)) throw new Error('The updated copy was not installed.');
        stopped([latestSource, running.app]);
        open(installed.app, { userData });
        save({ status: 'installed', app: installed.app, version: installed.version, build: installed.build, error: null });
        store.saveJson(store.statusPath(state), { status: 'installed', activeId: store.checkedActive(state)?.id,
          successStamp: stamp(latestSource), checkedAt: new Date(now()).toISOString(), error: null });
        return installed;
      } catch (error) {
        try { save({ status: 'failed', error: error.message, code: error.code || null }); }
        catch (recordError) { error.message += ' Could not record failure: ' + recordError.message; }
        if (exited) {
          try {
            stopped([source, running.app, store.checkedActive(state)?.app]);
            if (same(running.app, running.patched)) open(running.app, { userData });
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

module.exports = { check, install, recordFor, jobPath };
