const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const store = require('../../src/platforms/windows/store.cjs');
const automatic = require('../../src/platforms/windows/automatic.cjs');

test('Windows shortcut conversion repairs drift and restores original links without overwriting custom launches',
  { skip: process.platform !== 'win32' }, t => {
    // Windows runners can expose TEMP through an 8.3 alias; Shell COM returns
    // long paths. The native resolver expands aliases that realpathSync retains.
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-shortcuts-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../support/windows-shortcuts.ps1'),
        '-Implementation', path.join(__dirname, '../../src/platforms/windows/shortcuts.ps1'), '-Root', root],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout.trim()).passed, true);
  });

test('Windows monitoring repairs shortcuts while the app is open and when its generation is already current', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-shortcut-watch-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  store.saveJson(store.configPath(state), { enabled: true });
  const active = { id: 'active-id', revision: store.PATCH_REVISION, app: 'copy' };
  t.mock.method(store, 'checkedActive', () => active);
  let repaired = 0;
  const options = { resolve: () => 'official', getStamp: () => 'same-version',
    repairShortcuts: (directory, app) => { assert.equal(directory, state); assert.equal(app, active.app); repaired++; },
    stopped: () => { throw Object.assign(new Error('Still running'), { code: 'APP_RUNNING' }); },
    install: () => assert.fail('must not install while running') };
  assert.equal((await automatic.tick(state, options)).status, 'waiting-for-exit');
  store.saveJson(store.statusPath(state), { activeId: active.id, successStamp: 'same-version' });
  assert.equal((await automatic.tick(state, options)).status, 'idle');
  assert.equal(repaired, 2);
});
