const tx = require('./transaction.cjs');
const platform = require('./platform.cjs');
const storage = require('./storage.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function alreadyInstalled(app, state) {
  try {
    const current = tx.marker(app);
    if (!current || current.patchId !== tx.PATCH_ID || current.revision !== tx.PATCH_REVISION) return false;
    if (!storage.matchesMarker(state, app, current)) return false;
    const record = tx.checkedRecord(state, app);
    return record?.phase === 'installed' && current.id === record.id && tx.same(app, record.patched);
  } catch {
    return false;
  }
}

// The caller holds the transaction lock through preparation, activation and reopening.
async function restart(app, state, { onPhase = () => {}, install = tx.install,
  running = platform.isRunning, quit = platform.requestQuit, open = platform.openApp,
  forceQuit = platform.forceQuit,
  safeToOpen = () => !['prepared', 'activated', 'rollback-pending'].includes(tx.checkedRecord(state, app)?.phase),
  patched = alreadyInstalled, beforeQuit = () => {}, allowForceQuit = false, timeoutMs = 30000,
  forceQuitTimeoutMs = 10000, pollMs = 200, now = Date.now, wait = delay } = {}) {
  // A KeepAlive launchd job that re-invokes restart must not bounce an already patched app.
  if (patched(app, state)) {
    onPhase('already-installed');
    if (!running(app)) {
      onPhase('reopening');
      await open(app);
      return { status: 'already-installed', reopened: true, closedMilliseconds: null };
    }
    return { status: 'already-installed', reopened: false, closedMilliseconds: null };
  }
  const startedAt = now();
  let preparationMilliseconds;
  let activationRequested = false;
  let quitRequested = false;
  let closedAt;
  const beforeActivate = async () => {
    if (activationRequested) return;
    await beforeQuit();
    activationRequested = true;
    preparationMilliseconds = now() - startedAt;
    if (running(app)) {
      onPhase('requesting-quit');
      quitRequested = true;
      await quit(app);
      const waitForExit = async (milliseconds, message) => {
        const deadline = now() + milliseconds;
        while (running(app)) {
          if (now() >= deadline) throw Object.assign(new Error(message), { code: 'QUIT_TIMEOUT' });
          await wait(pollMs);
        }
      };
      try {
        await waitForExit(timeoutMs, 'The app did not exit. Close any quit confirmation and retry. No app files were changed.');
      } catch (error) {
        if (error.code !== 'QUIT_TIMEOUT' || !allowForceQuit || !running(app)) throw error;
        onPhase('forcing-quit');
        await forceQuit(app);
        await waitForExit(forceQuitTimeoutMs, 'The app did not exit after a normal and forced quit request. No app files were changed.');
      }
      closedAt = now();
    }
    onPhase('applying');
  };
  try {
    onPhase('preparing');
    const result = await install(app, state, { onPhase, beforeActivate });
    if (!['installed', 'already-installed'].includes(result.status)) throw new Error(`Patch was not installed: ${result.status}`);
    // A user may have opened the newly installed app before this check.
    if (!running(app)) { onPhase('reopening'); await open(app); }
    return { ...result, reopened: true, preparationMilliseconds,
      closedMilliseconds: closedAt === undefined ? null : now() - closedAt };
  } catch (error) {
    let reopenedAfterFailure = false;
    if (quitRequested && !running(app)) {
      try { if (await safeToOpen()) { await open(app); reopenedAfterFailure = true; } }
      catch (reopenError) { error.message += ` Reopen failed: ${reopenError.message}`; }
    }
    error.reopenedAfterFailure = reopenedAfterFailure;
    throw error;
  }
}
module.exports = { restart };
