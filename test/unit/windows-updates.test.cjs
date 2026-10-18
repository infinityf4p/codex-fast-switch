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
const identity = require('../../src/platforms/windows/identity.cjs');
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

function clientFixture(t, { responseButton = 1 } = {}) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-client-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const app = new EventEmitter();
  app.getLocale = () => 'en';
  app.getPath = () => 'C:\\Profiles\\A & B';
  const dialogs = [], events = [], opened = [], queryOptions = [];
  let response = { available: true };
  let helper = null;
  let official = null;
  let queries = 0;
  const manager = { setUpdateReady: value => events.push(['ready', value]),
    setUpdateLifecycleState: value => events.push(['state', value]),
    setDownloadProgressPercent: value => events.push(['progress', value]),
    prepareWindowsUpdate: async () => events.push(['prepare']),
    options: { onInstallUpdatesRequested: () => events.push(['quit']), onInstallUpdatesAborted: () => events.push(['abort']) } };
  const client = createUpdater(manager, { state, id: 'id' }, {
    electron: { app, dialog: { showMessageBox: async data => { dialogs.push(data); return { response: responseButton }; } },
      shell: { openExternal: url => opened.push(url) } },
    childProcess: {
      execFile: (_node, args, options, callback) => {
        assert.equal(options.windowsHide, true);
        if (args[1] === 'official') {
          official = { complete: value => callback(null, JSON.stringify(value)),
            progress: value => store.saveJson(path.join(state, 'windows-official-update.json'),
              { id: 'id', checkedAt: Date.now(), ...value }) };
        } else if (args[1] === 'start') {
          const file = handoff.ticketPath(state, args[4]);
          helper = { file, setStatus: extra => store.saveJson(file, { ...store.readOptional(file), ...extra }) };
          queueMicrotask(() => callback(null, JSON.stringify({ started: true })));
        } else { queries++; queryOptions.push(args[4]); queueMicrotask(() => callback(null, JSON.stringify(response))); }
      },
    },
  });
  t.after(() => app.emit('will-quit'));
  return { client, dialogs, events, opened, queryOptions, setResponse: value => { response = value; },
    get official() { return official; }, get helper() { return helper; }, get queries() { return queries; } };
}

test('background checks feed native readiness without launching the Store or quitting', async t => {
  const f = clientFixture(t);
  await Promise.all([f.client.checkForUpdatesInBackground(), f.client.checkForUpdatesInBackground()]);
  assert.equal(f.queries, 1);
  assert.equal(f.client.getIsUpdateReady(), true);
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.opened, []);
  assert.equal(f.events.some(event => event[0] === 'quit'), false);
  f.setResponse({ available: false });
  await f.client.checkForUpdates();
  assert.equal(f.client.getIsUpdateReady(), false);
  assert.equal(f.dialogs[0].buttons[0], 'Open Microsoft Store');
  assert.equal(f.queryOptions.at(-1), 'force');
});

test('one native click installs the official update before patch handoff and preserves the profile', async t => {
  const f = clientFixture(t, { responseButton: 0 });
  f.setResponse({ available: true, localAvailable: false,
    official: { status: 'available', installedVersion: '26.915.4065.0', version: '26.1007.2314.0' } });
  await f.client.checkForUpdatesInBackground();
  assert.equal(f.client.getIsUpdateReady(), true);
  assert.deepEqual(f.opened, []);
  const operation = f.client.installUpdatesIfAvailable();
  assert.equal(f.client.installUpdatesIfAvailable(), operation);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.official);
  assert.deepEqual(f.opened, []);
  assert.equal(f.helper, null);
  assert.equal(f.events.some(event => ['quit', 'prepare'].includes(event[0])), false);
  f.official.progress({ phase: 'downloading', percent: 48 });
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.ok(f.events.some(event => event[0] === 'progress' && event[1] === 48));
  // No second click is needed after Windows registers the new official package.
  f.setResponse({ available: true, localAvailable: true, official: { status: 'current' } });
  f.official.complete({ status: 'installed', version: '26.1007.2314.0' });
  await new Promise(resolve => setImmediate(resolve));
  f.helper.setStatus({ status: 'ready' });
  await operation;
  assert.deepEqual(f.events.slice(-2), [['prepare'], ['quit']]);
  assert.equal(store.readOptional(f.helper.file).userData, 'C:\\Profiles\\A & B');
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.opened, []);
});

test('failed official download or installation leaves the current app running and allows retry', async t => {
  const f = clientFixture(t);
  f.setResponse({ available: true, localAvailable: false, official: { status: 'available' } });
  await f.client.checkForUpdatesInBackground();
  for (const error of ['Network unavailable', 'Windows rejected the package signature']) {
    const operation = f.client.installUpdatesIfAvailable();
    await new Promise(resolve => setImmediate(resolve));
    f.official.complete({ error });
    await operation;
    assert.equal(f.dialogs.at(-1).detail, error);
    assert.equal(f.helper, null);
    assert.equal(f.events.some(event => ['quit', 'prepare'].includes(event[0])), false);
    assert.equal(f.client.getIsUpdateReady(), true);
    assert.deepEqual(f.opened, []);
  }
});

test('a catalog-only version without a released download does not begin a spurious copy update', async t => {
  const f = clientFixture(t);
  f.setResponse({ available: true, localAvailable: false, official: { status: 'available' } });
  const operation = f.client.installUpdatesIfAvailable();
  await new Promise(resolve => setImmediate(resolve));
  f.official.complete({ status: 'current' });
  await operation;
  assert.equal(f.helper, null);
  assert.match(f.dialogs[0].detail, /does not have an automatic download/);
});

test('a manual offline Store check never claims the official app is current', async t => {
  const f = clientFixture(t);
  f.setResponse({ available: false, localAvailable: false, official: { status: 'unknown' } });
  await f.client.checkForUpdates();
  assert.equal(f.dialogs[0].type, 'warning');
  assert.equal(f.dialogs[0].message, 'Could not check official updates');
  assert.equal(f.events.some(event => event[0] === 'quit'), false);
  await f.client.installUpdatesIfAvailable();
  assert.equal(f.dialogs[1].message, 'Could not check official updates');
  assert.equal(f.helper, null);
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
  await handoff.install(state, 'id', token, { environment, assertIndependent: () => {},
    wait: async () => {
      assert.equal(store.readOptional(file).status, 'ready');
      store.saveJson(file, { ...ticket, status: 'install', userData: 'isolated-profile' });
      approved = true;
    },
    installCopy: async (_state, _id, { ready }) => {
      const profile = await ready();
      assert.equal(approved, true);
      assert.equal(profile, 'isolated-profile');
      assert.equal(store.readOptional(file).workerPid, process.pid);
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
  await assert.rejects(handoff.install(state, 'id', token, { environment: {}, assertIndependent: () => {}, installCopy: async (_state, _id, { ready }) => {
    await ready();
    assert.fail('must not install before approval');
  } }), /closed before confirming/);
  assert.equal(store.readOptional(file).status, 'failed');
});

test('a package-owned helper fails before readiness so the running app cannot quit', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-handoff-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const token = crypto.randomUUID(), file = handoff.ticketPath(state, token);
  store.saveJson(file, { id: 'id', token, parentPid: process.pid, createdAt: Date.now(), status: 'starting', environment: {} });
  await assert.rejects(handoff.install(state, 'id', token, {
    environment: {}, assertIndependent: () => { throw new Error('helper still belongs to an app package'); },
    installCopy: () => assert.fail('must not prepare or request quit from a package-owned worker'),
  }), /still belongs/);
  assert.equal(store.readOptional(file).status, 'failed');
  assert.match(store.readOptional(file).error, /still belongs/);
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

test('timestamp-only source changes do not offer the same update again', t => {
  const f = fixture(t);
  for (const file of platform.identityFiles()) {
    const target = path.join(f.source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'original ' + file);
  }
  f.running.original = platform.fingerprint(f.source);
  f.running.sourceStamp = platform.stamp(f.source);
  const journal = path.join(f.state, 'versions', f.running.id, 'record.json');
  store.saveJson(journal, f.running);
  const check = () => updates.check(f.state, f.running.id, { resolve: () => f.source,
    metadata: () => ({ arch: 'x64', version: '1', build: '1' }) });
  assert.equal(check().available, false);

  const runtime = path.join(f.source, 'owl-shell-runtime.json');
  const original = fs.readFileSync(runtime);
  const modified = fs.statSync(runtime).mtimeMs + 10000;
  fs.utimesSync(runtime, new Date(modified), new Date(modified));
  assert.notEqual(platform.stamp(f.source), f.running.sourceStamp);
  assert.equal(check().available, false);
  assert.equal(check().available, false);

  // A republished build with changed content must still be offered, even with the same version.
  fs.appendFileSync(runtime, ' changed');
  assert.equal(check().available, true);
  fs.writeFileSync(runtime, original);
  assert.equal(check().available, false);

  delete f.running.sourceStamp;
  store.saveJson(journal, f.running);
  assert.equal(check().available, false);
  fs.appendFileSync(path.join(f.source, 'chrome.dll'), ' changed');
  assert.equal(check().available, true);
});

test('update installation waits for exit before publishing and reopening the new generation', async t => {
  const f = fixture(t), events = [];
  let exited = false;
  let next;
  const userData = path.join(f.root, 'profile');
  await updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stamp: () => '2',
    preflight: async source => { assert.equal(source, f.source); events.push('preflight'); },
    ready: async () => { events.push('ready'); return userData; },
    stopped: apps => { if (apps.includes(f.running.app) && !exited) throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); },
    wait: async () => { events.push('exit'); exited = true; },
    installCopy: async () => {
      assert.equal(exited, true);
      const intent = store.readOptional(updates.jobPath(f.state));
      assert.equal(intent.reopen.userData, userData);
      assert.equal(Object.hasOwn(intent.reopen.environment, 'OPENAI_API_KEY'), false);
      next = f.makeRecord('2');
      store.saveJson(store.activePath(f.state), next);
      events.push('install');
      return { status: 'installed', ...next };
    },
    open: (app, options) => { assert.equal(app, next.app); assert.equal(options.userData, userData); events.push('open'); },
  });
  assert.deepEqual(events, ['preflight', 'ready', 'exit', 'install', 'open']);
  assert.equal(store.readOptional(updates.jobPath(f.state)).status, 'installed');
  assert.equal(store.readOptional(updates.jobPath(f.state)).reopen, null);
});

function interruptedUpdate(t) {
  const f = fixture(t), next = { ...f.makeRecord('2'), installedAt: new Date(2000).toISOString() };
  const job = { id: crypto.randomUUID(), fromId: f.running.id, status: 'installing', phase: 'prepared',
    reopen: { userData: path.join(f.root, 'same profile'), environment: { CODEX_HOME: 'same-home' },
      requestedAt: new Date(1000).toISOString() } };
  store.saveJson(store.activePath(f.state), next);
  store.saveJson(updates.jobPath(f.state), job);
  return { ...f, next, job };
}

test('the monitor completes a confirmed restart after the updater disappears following publication', async t => {
  const f = interruptedUpdate(t), calls = [];
  store.saveJson(store.configPath(f.state), { enabled: true });
  const options = { now: () => 3000, same: () => true, verify: () => {}, processes: () => [],
    register: app => { assert.equal(app, f.next.app); calls.push('register'); },
    configure: (_state, app) => { assert.equal(app, f.next.app); calls.push('shortcuts'); },
    open: (app, options) => {
      assert.equal(app, f.next.app);
      assert.deepEqual(options, { userData: f.job.reopen.userData, env: f.job.reopen.environment });
      calls.push('open');
    } };
  const result = await automatic.tick(f.state, {
    recoverUpdate: state => updates.recover(state, options),
    resolve: () => assert.fail('a published generation can finish opening without a second installation'),
  });
  assert.equal(result.reopened, true);
  assert.deepEqual(calls, ['register', 'shortcuts', 'open']);
  assert.equal(store.readOptional(updates.jobPath(f.state)).status, 'installed');
  assert.equal(store.readOptional(updates.jobPath(f.state)).reopen, null);
  assert.equal(updates.recover(f.state, options), null);
  assert.deepEqual(calls, ['register', 'shortcuts', 'open']);
});

test('recovery acknowledges a manually opened new copy without activating it again', t => {
  const f = interruptedUpdate(t);
  const result = updates.recover(f.state, { now: () => 3000,
    processes: () => [{ path: platform.binaryPath(f.next.app) }],
    register: () => assert.fail('must not change a running package'),
    open: () => assert.fail('must not reopen or steal focus'),
  });
  assert.equal(result.reopened, false);
  assert.equal(store.readOptional(updates.jobPath(f.state)).status, 'installed');
});

test('normal exits, cancelled updates, expired intents and unpublished copies do not auto-open', t => {
  const f = interruptedUpdate(t);
  const options = { now: () => 3000, open: () => assert.fail('no confirmed pending restart') };
  for (const job of [null, { ...f.job, reopen: null }, { ...f.job, status: 'failed' },
    { ...f.job, status: 'installed' }, { ...f.job, status: 'waiting-for-exit' },
    { ...f.job, reopen: { ...f.job.reopen, userData: 'relative-profile' } },
    { ...f.job, reopen: { ...f.job.reopen, requestedAt: new Date(-3600000).toISOString() } },
    { ...f.job, reopen: { ...f.job.reopen, requestedAt: new Date(4000).toISOString() } }]) {
    store.saveJson(updates.jobPath(f.state), job);
    assert.equal(updates.recover(f.state, options), null);
  }
  store.saveJson(updates.jobPath(f.state), f.job);
  store.saveJson(store.activePath(f.state), f.running);
  assert.equal(updates.recover(f.state, options), null);
  store.saveJson(store.activePath(f.state), { ...f.next, installedAt: new Date(0).toISOString() });
  assert.equal(updates.recover(f.state, options), null);
});

for (const failure of ['another-app', 'changed-copy', 'registration', 'activation']) {
  test(`interrupted restart stops after ${failure} failure without repeated auto-opening`, t => {
    const f = interruptedUpdate(t), calls = [];
    const options = { now: () => 3000,
      processes: () => failure === 'another-app' ? [{ path: platform.binaryPath(f.source) }] : [],
      same: () => failure !== 'changed-copy', verify: () => {},
      register: () => { calls.push('register'); if (failure === 'registration') throw new Error('Registration failed'); },
      configure: () => {},
      open: () => { calls.push('open'); throw new Error('Activation failed'); },
    };
    assert.throws(() => updates.recover(f.state, options));
    assert.equal(store.readOptional(updates.jobPath(f.state)).status, 'failed');
    assert.equal(store.readOptional(updates.jobPath(f.state)).reopen, null);
    const completedCalls = [...calls];
    assert.equal(updates.recover(f.state, options), null);
    assert.deepEqual(calls, completedCalls);
    assert.equal(calls.includes('open'), failure === 'activation');
  });
}

test('failed updates preserve the pointer and reopen the old copy after exit', async t => {
  const f = fixture(t), opened = [];
  t.mock.method(launcher, 'restorePrevious', () => assert.fail('the installer already handles its rollback'));
  await assert.rejects(updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stopped: () => {},
    preflight: async () => {},
    ready: async () => path.join(f.root, 'profile'),
    installCopy: async () => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }); },
    open: app => opened.push(app),
  }), { code: 'ENOSPC' });
  assert.deepEqual(opened, [f.running.app]);
  assert.equal(store.checkedActive(f.state).id, f.running.id);
  assert.equal(store.readOptional(updates.jobPath(f.state)).error, 'Disk full');
});

for (const advanced of [false, true]) test(`update activation failure restores and opens the previous active generation (advanced=${advanced})`, async t => {
  const f = fixture(t), calls = [], previous = advanced ? f.makeRecord('2') : f.running;
  const next = f.makeRecord('3'), userData = path.join(f.root, 'same profile');
  store.saveJson(store.activePath(f.state), previous);
  fs.writeFileSync(path.join(path.dirname(previous.app), 'AppxManifest.xml'), identity.manifest('x64'));
  t.mock.method(identity, 'registerExisting', app => {
    assert.equal(app, previous.app);
    assert.deepEqual(store.checkedActive(f.state), previous);
    calls.push('identity');
  });
  await assert.rejects(updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stopped: () => {},
    preflight: async () => {}, ready: async () => userData,
    installCopy: async () => {
      store.saveJson(store.activePath(f.state), next);
      return { status: 'installed', ...next };
    },
    open(app, options) {
      assert.equal(options.userData, userData);
      if (app === next.app) { calls.push('new'); throw new Error('Activation failed'); }
      assert.equal(app, previous.app);
      assert.deepEqual(store.checkedActive(f.state), previous);
      calls.push('old');
    },
  }), /Activation failed/);
  assert.deepEqual(calls, ['new', 'identity', 'old']);
  assert.equal(store.readOptional(updates.jobPath(f.state)).status, 'failed');
});

for (const reopened of ['new', 'latestSource']) test(`update activation failure does not replace a running ${reopened}`, async t => {
  const f = fixture(t), next = f.makeRecord('2'), latestSource = path.join(f.root, 'new official');
  let attempted = false, resolutions = 0;
  t.mock.method(launcher, 'restorePrevious', () => assert.fail('must not change a running package identity'));
  await assert.rejects(updates.install(f.state, f.running.id, {
    resolve: () => ++resolutions === 1 ? f.source : latestSource,
    verify: () => {}, same: () => true, preflight: async () => {}, ready: async () => path.join(f.root, 'profile'),
    stopped(apps) {
      if (!attempted) return;
      for (const app of [f.source, latestSource, f.running.app, next.app]) assert.equal(apps.includes(app), true);
      throw Object.assign(new Error(`${reopened} is running`), { code: 'APP_RUNNING' });
    },
    installCopy: async () => {
      store.saveJson(store.activePath(f.state), next);
      return { status: 'installed', ...next };
    },
    open(app) {
      assert.equal(app, next.app);
      assert.equal(attempted, false);
      attempted = true;
      throw new Error('Activation failed');
    },
  }), /Activation failed/);
  assert.deepEqual(store.checkedActive(f.state), next);
});

test('update activation failure without a previous active copy clears local activation and reopens the original profile', async t => {
  const f = fixture(t), next = f.makeRecord('2'), calls = [], userData = path.join(f.root, 'profile');
  fs.unlinkSync(store.activePath(f.state));
  t.mock.method(identity, 'remove', prepared => {
    assert.equal(store.checkedActive(f.state), null);
    assert.deepEqual(prepared.roots, [path.dirname(next.app)]);
    calls.push('remove');
  });
  await assert.rejects(updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stopped: () => {},
    preflight: async () => {}, ready: async () => userData,
    installCopy: async () => {
      store.saveJson(store.activePath(f.state), next);
      return { status: 'installed', ...next };
    },
    open(app, options) {
      assert.equal(options.userData, userData);
      if (app === next.app) { calls.push('new'); throw new Error('Activation failed'); }
      assert.equal(app, f.source);
      calls.push('official');
    },
  }), /Activation failed/);
  assert.deepEqual(calls, ['new', 'remove', 'official']);
});

test('unsupported updates fail before signaling readiness or closing the running app', async t => {
  const f = fixture(t);
  await assert.rejects(updates.install(f.state, f.running.id, {
    resolve: () => f.source, verify: () => {}, same: () => true, stopped: () => {},
    preflight: async () => { throw Object.assign(new Error('Unsupported request logic'), { code: 'UNSUPPORTED_PATCH' }); },
    ready: () => assert.fail('must not ask the app to quit'),
    installCopy: () => assert.fail('must not publish an incompatible copy'),
    open: () => assert.fail('the existing app is still running'),
  }), { code: 'UNSUPPORTED_PATCH' });
  assert.equal(store.checkedActive(f.state).id, f.running.id);
  const job = store.readOptional(updates.jobPath(f.state));
  assert.equal(job.status, 'failed');
  assert.equal(job.code, 'UNSUPPORTED_PATCH');
});

test('installer and manual restart also check compatibility before quitting', async t => {
  const f = fixture(t);
  await assert.rejects(launch(f.state, f.source, { restart: true,
    preflight: async source => { assert.equal(source, f.source); throw new Error('Unsupported request logic'); },
    quit: () => assert.fail('must not quit before compatibility checks pass'),
    install: () => assert.fail('must not publish an incompatible copy'),
    open: () => assert.fail('the existing app is still running'),
  }), /Unsupported request logic/);
  assert.equal(store.checkedActive(f.state).id, f.running.id);
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
  t.mock.method(store, 'doctor', async () => ({ status: 'recognized' }));
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
