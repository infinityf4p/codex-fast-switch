const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { parse, shape } = require('../../src/core/adaptive.cjs');
const { adapt } = require('../../src/platforms/windows/updater.cjs');
const createUpdater = require('../../src/platforms/windows/updater-client.cjs');
const updates = require('../../src/platforms/windows/updates.cjs');
const handoff = require('../../src/platforms/windows/update-handoff.cjs');
const store = require('../../src/platforms/windows/store.cjs');
const automatic = require('../../src/platforms/windows/automatic.cjs');
const platform = require('../../src/platforms/windows/platform.cjs');
const launcher = require('../../src/platforms/windows/launcher.cjs');
const { main, launch } = require('../../src/platforms/windows/cli.cjs');

test('native updater adaptation changes only a recognized Windows initializer', () => {
  const source = 'class Manager { async initializeWindowsUpdater(){return 1;} ' +
    'setUpdateReady(){} setUpdateLifecycleState(){} checkForUpdates(){} installUpdatesIfAvailable(){} getIsUpdateReady(){} }';
  const original = parse(source).body[0].body.body;
  const accepted = new Set([shape(original[0]).fingerprint]);
  const patched = adapt(source, { state: 'C:\\A & B\\Fast', id: 'generation' }, accepted).toString();
  const transformed = parse(patched).body[0].body.body;
  assert.notEqual(shape(original[0]).fingerprint, shape(transformed[0]).fingerprint);
  assert.deepEqual(original.slice(1).map(shape), transformed.slice(1).map(shape));
  assert.throws(() => adapt(source.replace('return 1', 'return 2'), {}, accepted), { code: 'UNSUPPORTED_UPDATER' });
  assert.throws(() => adapt(source + source.replace('class Manager', 'class Other'), {}, accepted), { code: 'UNSUPPORTED_UPDATER' });
});

function clientFixture(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-client-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const app = new EventEmitter();
  app.getLocale = () => 'en';
  app.getPath = () => 'C:\\Profiles\\A & B';
  const dialogs = [], events = [];
  let response = { available: true };
  let helper = null;
  let queries = 0;
  const manager = { setUpdateReady: value => events.push(['ready', value]),
    setUpdateLifecycleState: value => events.push(['state', value]),
    prepareWindowsUpdate: async () => events.push(['prepare']),
    options: { onInstallUpdatesRequested: () => events.push(['quit']), onInstallUpdatesAborted: () => events.push(['abort']) } };
  const client = createUpdater(manager, { state, id: 'id' }, {
    electron: { app, dialog: { showMessageBox: async data => { dialogs.push(data); return { response: 1 }; } },
      shell: { openExternal: () => assert.fail('must not open a store during background checks') } },
    childProcess: {
      execFile: (_node, args, options, callback) => {
        assert.equal(options.windowsHide, true);
        if (args[1] === 'start') {
          const file = handoff.ticketPath(state, args[4]);
          helper = { file, setStatus: extra => store.saveJson(file, { ...store.readOptional(file), ...extra }) };
          queueMicrotask(() => callback(null, JSON.stringify({ started: true })));
        } else { queries++; queueMicrotask(() => callback(null, JSON.stringify(response))); }
      },
    },
  });
  t.after(() => app.emit('will-quit'));
  return { client, dialogs, events, setResponse: value => { response = value; }, get helper() { return helper; }, get queries() { return queries; } };
}

test('background checks feed native readiness without launching the Store or quitting', async t => {
  const f = clientFixture(t);
  await Promise.all([f.client.checkForUpdatesInBackground(), f.client.checkForUpdatesInBackground()]);
  assert.equal(f.queries, 1);
  assert.equal(f.client.getIsUpdateReady(), true);
  assert.deepEqual(f.dialogs, []);
  assert.equal(f.events.some(event => event[0] === 'quit'), false);
  f.setResponse({ available: false });
  await f.client.checkForUpdates();
  assert.equal(f.client.getIsUpdateReady(), false);
  assert.equal(f.dialogs[0].buttons[0], 'Open Microsoft Store');
});

test('the native Update action waits for helper readiness and preserves the profile', async t => {
  const f = clientFixture(t);
  await f.client.checkForUpdatesInBackground();
  const operation = f.client.installUpdatesIfAvailable();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.some(event => event[0] === 'quit'), false);
  f.helper.setStatus({ status: 'ready' });
  await operation;
  assert.deepEqual(f.events.slice(-2), [['prepare'], ['quit']]);
  const ticket = store.readOptional(f.helper.file);
  assert.equal(ticket.status, 'install');
  assert.equal(ticket.userData, 'C:\\Profiles\\A & B');
  assert.equal(Object.hasOwn(ticket.environment, 'OPENAI_API_KEY'), false);
  assert.equal(Object.hasOwn(ticket.environment, 'NODE_OPTIONS'), false);
});

test('a failed helper leaves the app running with an actionable native dialog', async t => {
  const f = clientFixture(t);
  await f.client.checkForUpdatesInBackground();
  const operation = f.client.installUpdatesIfAvailable();
  await new Promise(resolve => setImmediate(resolve));
  f.helper.setStatus({ status: 'failed', error: 'Disk full' });
  await operation;
  assert.equal(f.events.some(event => event[0] === 'quit'), false);
  assert.equal(f.dialogs[0].detail, 'Disk full');
  assert.equal(f.client.getIsUpdateReady(), true);
});

test('brokered update waits for approval and carries the isolated environment through relaunch', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-handoff-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const token = crypto.randomUUID(), file = handoff.ticketPath(state, token);
  const ticket = { id: 'id', token, parentPid: process.pid, createdAt: Date.now(), status: 'starting',
    environment: { CODEX_HOME: 'isolated-home', APPDATA: 'isolated-app-data' } };
  store.saveJson(file, ticket);
  const environment = { OPENAI_API_KEY: 'must-not-inherit-from-Explorer' };
  let approved = false;
  await handoff.install(state, 'id', token, { environment,
    wait: async () => {
      assert.equal(store.readOptional(file).status, 'ready');
      store.saveJson(file, { ...ticket, status: 'install', userData: 'isolated-profile' });
      approved = true;
    },
    installCopy: async (_state, _id, { ready }) => {
      const profile = await ready();
      assert.equal(approved, true);
      assert.equal(profile, 'isolated-profile');
    },
  });
  assert.deepEqual(environment, ticket.environment);
  assert.equal(fs.existsSync(file), false);
  assert.throws(() => handoff.ticketPath(state, '../escape'), /Invalid update handoff/);
});

test('closing the app before approval cancels a brokered update without installing', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-handoff-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const token = crypto.randomUUID(), file = handoff.ticketPath(state, token);
  store.saveJson(file, { id: 'id', token, parentPid: 2147483647, createdAt: Date.now(), status: 'starting', environment: {} });
  await assert.rejects(handoff.install(state, 'id', token, { environment: {}, installCopy: async (_state, _id, { ready }) => {
    await ready();
    assert.fail('must not install before approval');
  } }), /closed before confirming/);
  assert.equal(store.readOptional(file).status, 'failed');
});

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-updates-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const state = path.join(root, 'state'), source = path.join(root, 'official');
  fs.mkdirSync(source);
  const makeRecord = version => {
    const id = Date.now() + '-' + crypto.randomUUID();
    const app = path.join(state, 'versions', id, 'app');
    fs.mkdirSync(app, { recursive: true });
    const record = { patchId: store.PATCH_ID, revision: store.PATCH_REVISION, phase: 'installed',
      source, id, app, arch: 'x64', version, build: version, original: {}, patched: {}, sourceStamp: version };
    store.saveJson(path.join(state, 'versions', id, 'record.json'), record);
    return record;
  };
  const running = makeRecord('1');
  store.saveJson(store.activePath(state), running);
  return { root, state, source, running, makeRecord };
}

test('checks compare the running generation even when the active pointer has advanced', t => {
  const f = fixture(t);
  store.saveJson(store.activePath(f.state), f.makeRecord('2'));
  const result = updates.check(f.state, f.running.id, { resolve: () => f.source,
    metadata: () => ({ arch: 'x64', version: '2', build: '2' }), stamp: () => '2' });
  assert.equal(result.available, true);
  assert.throws(() => updates.recordFor(f.state, '../escape'), /Invalid update generation/);
});

test('update installation waits for exit before publishing and reopening the new generation', async t => {
  const f = fixture(t), events = [];
  let exited = false;
  let next;
  const userData = path.join(f.root, 'profile');
  await updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stamp: () => '2',
    ready: async () => { events.push('ready'); return userData; },
    stopped: apps => { if (apps.includes(f.running.app) && !exited) throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); },
    wait: async () => { events.push('exit'); exited = true; },
    installCopy: async () => {
      assert.equal(exited, true);
      next = f.makeRecord('2');
      store.saveJson(store.activePath(f.state), next);
      events.push('install');
      return { status: 'installed', ...next };
    },
    open: (app, options) => { assert.equal(app, next.app); assert.equal(options.userData, userData); events.push('open'); },
  });
  assert.deepEqual(events, ['ready', 'exit', 'install', 'open']);
  assert.equal(store.readOptional(updates.jobPath(f.state)).status, 'installed');
});

test('failed updates preserve the pointer and reopen the old copy after exit', async t => {
  const f = fixture(t), opened = [];
  await assert.rejects(updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stopped: () => {},
    ready: async () => path.join(f.root, 'profile'),
    installCopy: async () => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }); },
    open: app => opened.push(app),
  }), { code: 'ENOSPC' });
  assert.deepEqual(opened, [f.running.app]);
  assert.equal(store.checkedActive(f.state).id, f.running.id);
  assert.equal(store.readOptional(updates.jobPath(f.state)).error, 'Disk full');
});

test('temporary monitoring failures retry after backoff without waiting for a new official build', async t => {
  const f = fixture(t);
  store.saveJson(store.configPath(f.state), { enabled: true });
  let time = 0, calls = 0;
  const options = { resolve: () => f.source, getStamp: () => '2', now: () => time, stopped: () => {},
    install: async () => {
      if (++calls === 1) throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
      return { status: 'already-installed' };
    } };
  assert.equal((await automatic.tick(f.state, options)).status, 'failed');
  assert.equal((await automatic.tick(f.state, options)).status, 'retry-pending');
  assert.equal(calls, 1);
  time = 30000;
  assert.equal((await automatic.tick(f.state, options)).status, 'installed');
  assert.equal(calls, 2);
});

test('normal launch installs the new official version before opening a stopped copy', async t => {
  const f = fixture(t), events = [];
  await launch(f.state, f.source, { verify: () => {}, same: app => app !== f.source, processes: () => [],
    install: async () => { events.push('install'); return { status: 'installed', app: 'new-copy' }; },
    open: app => events.push(app),
  });
  assert.deepEqual(events, ['install', 'new-copy']);
});

test('opening a running copy sends activation instead of leaving its window hidden', async t => {
  const f = fixture(t), opened = [];
  const result = await launch(f.state, f.source, { verify: () => {}, same: () => true,
    processes: apps => apps.includes(f.running.app) ? [{ path: platform.binaryPath(f.running.app) }] : [],
    install: () => assert.fail('must not install while the copy is running'), open: app => opened.push(app) });
  assert.equal(result.status, 'opened');
  assert.deepEqual(opened, [f.running.app]);
});

test('setup finishes configuration and monitoring when another app reopens after publication', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  store.saveJson(store.activePath(f.state), { ...f.running, revision: 2 });
  store.saveJson(store.configPath(f.state), { enabled: true, workerRevision: 2, autoDiscover: true });
  let reopened = false;
  t.mock.method(store, 'resolveSource', () => f.source);
  t.mock.method(platform, 'processes', () => reopened ? [{ path: platform.binaryPath(f.source) }] : []);
  t.mock.method(platform, 'openApp', () => assert.fail('must not open another default-profile app'));
  t.mock.method(launcher, 'install', async () => {
    const next = f.makeRecord('2');
    store.saveJson(store.activePath(f.state), next);
    reopened = true;
    return { status: 'installed', ...next };
  });
  const enable = t.mock.method(automatic, 'enable', (state, source, options) => {
    assert.equal(state, f.state);
    assert.equal(source, f.source);
    assert.equal(options.autoDiscover, true);
    assert.equal(store.readOptional(store.configPath(state)).source, source);
    return { status: 'enabled' };
  });
  const result = await main(['setup', '--state', f.state]);
  assert.equal(result.status, 'installed');
  assert.equal(result.reopened, false);
  assert.equal(result.restartRequired, true);
  assert.equal(enable.mock.callCount(), 1);
  assert.equal(store.readOptional(store.statusPath(f.state)).restartRequired, true);
});

test('normal launch completes an interrupted monitor migration without restarting the app', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t), opened = [];
  store.saveJson(store.configPath(f.state), { enabled: true, workerRevision: 2, autoDiscover: true });
  t.mock.method(store, 'resolveSource', () => f.source);
  t.mock.method(platform, 'same', () => true);
  t.mock.method(platform, 'verify', () => {});
  t.mock.method(platform, 'processes', apps => apps.includes(f.running.app) ? [{ path: platform.binaryPath(f.running.app) }] : []);
  t.mock.method(platform, 'requestQuit', () => assert.fail('must not quit for monitor migration'));
  t.mock.method(platform, 'openApp', app => opened.push(app));
  const enable = t.mock.method(automatic, 'enable', () => ({ status: 'enabled' }));
  const result = await main(['launch', '--state', f.state]);
  assert.equal(result.status, 'opened');
  assert.deepEqual(opened, [f.running.app]);
  assert.equal(enable.mock.callCount(), 1);
  assert.equal(result.automatic.status, 'enabled');
});
