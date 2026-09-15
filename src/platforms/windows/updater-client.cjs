// Embedded inside the existing Windows updater initializer; no renderer changes.
module.exports = function createUpdater(manager, binding, dependencies = {}) {
  const { app, dialog, shell } = dependencies.electron || require('electron');
  const { execFile } = dependencies.childProcess || require('node:child_process');
  const fs = dependencies.fs || require('node:fs');
  const crypto = require('node:crypto');
  const path = require('node:path');
  const node = path.join(binding.state, 'agent/node.exe');
  const worker = path.join(binding.state, 'agent/src/platforms/windows/update-worker.cjs');
  const args = [worker, 'check', binding.state, binding.id];
  const storeUrl = 'ms-windows-store://pdp/?ProductId=9PLM9XGG6VKS';
  let inFlightCheck = null;
  let inFlightInstall = null;
  let ready = false;
  let lastFailure = null;
  let timer;
  const zh = app.getLocale().toLowerCase().startsWith('zh');
  const words = zh ? {
    failed: '\u66f4\u65b0\u672a\u5b8c\u6210',
    current: '\u672c\u673a\u5df2\u5b89\u88c5\u7684 Codex \u7248\u672c\u5df2\u540c\u6b65',
    store: '\u6253\u5f00 Microsoft Store', close: '\u5173\u95ed',
    storeDetail: '\u53ef\u5728 Microsoft Store \u67e5\u770b\u662f\u5426\u6709\u66f4\u65b0\u7684\u5b98\u65b9\u7248\u672c\u3002',
  } : { failed: 'Update did not complete', current: 'The installed Codex version is up to date',
    store: 'Open Microsoft Store', close: 'Close', storeDetail: 'Check Microsoft Store for a newer official version.' };
  const showError = error => dialog.showMessageBox({ type: 'error', title: words.failed,
    message: words.failed, detail: error.message || String(error), buttons: [words.close] });
  const setReady = value => { ready = value; manager.setUpdateReady(value); };

  function query() {
    if (!inFlightCheck) {
      inFlightCheck = new Promise((resolve, reject) => {
        execFile(node, args, { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          try {
            const result = JSON.parse(stdout);
            if (error || result.error) throw new Error(result.error || error.message);
            if (typeof result.available !== 'boolean') throw new Error('The update helper is incompatible. Run install.cmd again.');
            resolve(result);
          } catch (cause) { reject(error && !stdout ? new Error('The update helper could not run. Run install.cmd again.') : cause); }
        });
      }).finally(() => { inFlightCheck = null; });
    }
    return inFlightCheck;
  }

  async function check(manual) {
    if (inFlightInstall) return;
    if (manual) manager.setUpdateLifecycleState('checking');
    try {
      const result = await query();
      setReady(result.available);
      manager.setUpdateLifecycleState(ready ? 'ready' : 'idle');
      if (result.failure && result.failure.id !== lastFailure) {
        lastFailure = result.failure.id;
        await showError(new Error(result.failure.error));
      } else if (manual && !ready) {
        const response = await dialog.showMessageBox({ type: 'info', message: words.current,
          detail: words.storeDetail, buttons: [words.store, words.close], defaultId: 1, cancelId: 1 });
        if (response.response === 0) await shell.openExternal(storeUrl);
      }
    } catch (error) {
      manager.setUpdateLifecycleState(ready ? 'ready' : 'idle');
      if (manual) await showError(error);
      else manager.logger?.warning('Fast copy update check failed.', { safe: {}, sensitive: { error } });
    }
  }

  async function install() {
    let ticket, file;
    const save = extra => {
      ticket = { ...ticket, ...extra };
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify(ticket), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    };
    try {
      const result = await query();
      if (!result.available) { setReady(false); manager.setUpdateLifecycleState('idle'); return; }
      manager.setUpdateLifecycleState('installing');
      const token = crypto.randomUUID();
      file = path.join(binding.state, 'windows-update-' + token + '.json');
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        /^(SystemRoot|WINDIR|COMSPEC|ProgramFiles(?:\(x86\))?|ProgramW6432|PATH|PATHEXT|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|CODEX_HOME|CODEX_ELECTRON_USER_DATA_PATH|LANG|LC_ALL|OTEL_SDK_DISABLED)$/i.test(key)));
      save({ id: binding.id, token, parentPid: process.pid, createdAt: Date.now(), status: 'starting', environment });
      // A brokered worker survives Owl's process-job shutdown; an atomic ticket acknowledges readiness.
      await new Promise((resolve, reject) => {
        execFile(node, [worker, 'start', binding.state, binding.id, token], { windowsHide: true, timeout: 90000 }, (error, stdout) => {
          try {
            const result = JSON.parse(stdout);
            if (error || !result.started) throw new Error(result.error || 'The update helper could not start.');
            resolve();
          } catch (cause) { reject(cause); }
        });
      });
      const deadline = Date.now() + 120000;
      while (true) {
        const status = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (status.id !== binding.id || status.token !== token) throw new Error('The update handoff changed.');
        if (status.status === 'ready') break;
        if (status.status === 'failed') throw new Error(status.error);
        if (Date.now() >= deadline) throw new Error('The update helper did not become ready.');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await manager.prepareWindowsUpdate?.();
      save({ status: 'install', userData: app.getPath('userData') });
      if (manager.options.onInstallUpdatesRequested) manager.options.onInstallUpdatesRequested();
      else app.quit();
    } catch (error) {
      if (file) { try { save({ status: 'cancelled' }); } catch {} }
      manager.setUpdateLifecycleState(ready ? 'ready' : 'idle');
      manager.options.onInstallUpdatesAborted?.();
      await showError(error);
    }
  }

  return {
    initialize() {
      void check(false);
      timer = setInterval(() => { void check(false); }, 60000);
      timer.unref();
      app.once('will-quit', () => clearInterval(timer));
    },
    hasUpdater: () => true,
    getIsUpdateReady: () => ready,
    getUnavailableReason: () => null,
    checkForUpdates: () => check(true),
    checkForUpdatesInBackground: () => check(false),
    installUpdatesIfAvailable() {
      if (!inFlightInstall) inFlightInstall = install().finally(() => { inFlightInstall = null; });
      return inFlightInstall;
    },
  };
};
