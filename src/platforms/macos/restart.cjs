const tx = require('./transaction.cjs');
const platform = require('./platform.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function alreadyInstalled(app, state) {
  try {
    const current = tx.marker(app);
    if (!current || current.patchId !== tx.PATCH_ID || current.revision !== tx.PATCH_REVISION) return false;
    const record = tx.checkedRecord(state, app);
    return record?.phase === 'installed' && current.id === record.id && tx.same(app, record.patched);
  } catch {
    return false;
  }
}

// Keep the transaction lock held from the quit request until the app reopens.
async function restart(app, state, { onPhase = () => {}, install = tx.install,
  running = platform.isRunning, quit = platform.requestQuit, open = platform.openApp,
  safeToOpen = () => !['prepared', 'activated', 'rollback-pending'].includes(tx.checkedRecord(state, app)?.phase),
  patched = alreadyInstalled, timeoutMs = 30000, pollMs = 200, now = Date.now, wait = delay } = {}) {
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
  const wasRunning = running(app);
  let closedAt;
  if (wasRunning) {
    onPhase('requesting-quit');
    await quit(app);
    const deadline = now() + timeoutMs;
    while (running(app)) {
      if (now() >= deadline) throw Object.assign(new Error('The app did not exit. Close any quit confirmation and retry. No app files were changed.'), { code: 'QUIT_TIMEOUT' });
      await wait(pollMs);
    }
    closedAt = now();
  }
  try {
    onPhase('applying');
    const result = await install(app, state, { onPhase });
    if (!['installed', 'already-installed'].includes(result.status)) throw new Error(`Patch was not installed: ${result.status}`);
    // A user may have opened the newly installed app before this check.
    if (!running(app)) { onPhase('reopening'); await open(app); }
    return { ...result, reopened: true, closedMilliseconds: closedAt === undefined ? null : now() - closedAt };
  } catch (error) {
    let reopenedAfterFailure = false;
    if (wasRunning && !running(app)) {
      try { if (await safeToOpen()) { await open(app); reopenedAfterFailure = true; } }
      catch (reopenError) { error.message += ` Reopen failed: ${reopenError.message}`; }
    }
    error.reopenedAfterFailure = reopenedAfterFailure;
    throw error;
  }
}
module.exports = { restart };
