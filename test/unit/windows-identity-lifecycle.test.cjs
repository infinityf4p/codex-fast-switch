const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const store = require('../../src/platforms/windows/store.cjs');
const platform = require('../../src/platforms/windows/platform.cjs');
const automatic = require('../../src/platforms/windows/automatic.cjs');
const identity = require('../../src/platforms/windows/identity.cjs');
const cleanup = require('../../src/platforms/windows/cleanup.cjs');
const launcher = require('../../src/platforms/windows/launcher.cjs');
const cli = require('../../src/platforms/windows/cli.cjs');

function fixture(t) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-identity-lifecycle-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 }));
  const state = path.join(temporary, 'Fast state');
  const source = path.join(temporary, 'official');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'sentinel'), 'official unchanged');
  function generation() {
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const root = path.join(state, 'versions', id), app = path.join(root, 'app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(platform.binaryPath(app), 'synthetic copy');
    fs.writeFileSync(path.join(root, 'AppxManifest.xml'), identity.manifest('x64'));
    const record = { patchId: store.PATCH_ID, id, app, source, patched: {}, original: {}, revision: store.PATCH_REVISION };
    store.saveJson(path.join(root, 'record.json'), record);
    return { root, app, record };
  }
  const first = generation();
  store.saveJson(store.activePath(state), first.record);
  return { temporary, state, source, first, generation };
}

function stopped(t) {
  t.mock.method(platform, 'processes', () => []);
  t.mock.method(platform, 'assertStopped', () => {});
  t.mock.method(automatic, 'disable', () => ({ status: 'disabled' }));
}

test('uninstall finds owned package roots without relying on the active pointer or app executable', t => {
  const f = fixture(t);
  const second = f.generation();
  fs.rmSync(second.app, { recursive: true });
  fs.writeFileSync(store.activePath(f.state), '{broken pointer');
  const plan = cleanup.plan(f.state);
  assert.deepEqual(new Set(plan.roots), new Set([f.first.root, second.root]));
  assert.deepEqual(plan.apps, [f.first.app]);
  let called = false;
  identity.remove(plan, { run(action, data) {
    called = true;
    assert.equal(action, 'remove-identity');
    assert.equal(data.state, f.state);
    assert.deepEqual(new Set(data.roots), new Set(plan.roots));
    return { status: 'removed', removed: ['local-package'] };
  } });
  assert.equal(called, true);
});

test('uninstall refuses generation ownership mismatches before unregistering anything', async t => {
  const f = fixture(t);
  store.saveJson(path.join(f.first.root, 'record.json'), { ...f.first.record, patchId: 'unrelated' });
  t.mock.method(identity, 'remove', () => assert.fail('must validate ownership first'));
  await assert.rejects(cli.uninstall(f.state), /Invalid installation generation record/);
  assert.equal(fs.existsSync(f.first.app), true);
});

test('uninstall unregisters before removing files and leaves the official app untouched', async t => {
  const f = fixture(t);
  stopped(t);
  const calls = [];
  t.mock.method(identity, 'remove', prepared => {
    assert.deepEqual(prepared.roots, [f.first.root]);
    assert.equal(fs.existsSync(f.first.app), true);
    calls.push('unregister');
  });
  t.mock.method(launcher, 'remove', () => calls.push('shortcuts'));
  t.mock.method(store, 'resolveSource', () => f.source);
  t.mock.method(platform, 'verify', () => {});
  t.mock.method(platform, 'openApp', app => { assert.equal(app, f.source); calls.push('official'); });
  const result = await cli.uninstall(f.state);
  assert.deepEqual(calls, ['unregister', 'shortcuts', 'official']);
  assert.equal(result.cleaned, true);
  assert.equal(fs.existsSync(f.first.root), false);
  assert.equal(fs.readFileSync(path.join(f.source, 'sentinel'), 'utf8'), 'official unchanged');
});

test('failed unregistration leaves installation files and launch pointer available for retry', async t => {
  const f = fixture(t);
  stopped(t);
  t.mock.method(identity, 'remove', () => { throw new Error('AppX removal failed'); });
  t.mock.method(launcher, 'remove', () => assert.fail('must retain launch links on failure'));
  t.mock.method(cleanup, 'remove', () => assert.fail('must retain files on failure'));
  await assert.rejects(cli.uninstall(f.state), /AppX removal failed/);
  assert.deepEqual(store.checkedActive(f.state), f.first.record);
  assert.equal(fs.existsSync(f.first.app), true);
});

test('restore removes package activation but retains generations and then clears the launch pointer', t => {
  const f = fixture(t);
  stopped(t);
  let removed = 0;
  t.mock.method(identity, 'remove', prepared => {
    assert.deepEqual(prepared.roots, [f.first.root]);
    assert.deepEqual(store.checkedActive(f.state), f.first.record);
    removed++;
  });
  t.mock.method(launcher, 'remove', () => {});
  assert.equal(cli.restore(f.state).status, 'restored');
  assert.equal(removed, 1);
  assert.equal(store.checkedActive(f.state), null);
  assert.equal(fs.existsSync(f.first.app), true);
});

test('restore preserves its pointer when unregistration fails and refuses running copies first', t => {
  const f = fixture(t);
  stopped(t);
  const remove = t.mock.method(identity, 'remove', () => { throw new Error('AppX busy'); });
  assert.throws(() => cli.restore(f.state), /AppX busy/);
  assert.deepEqual(store.checkedActive(f.state), f.first.record);
  t.mock.method(platform, 'assertStopped', () => { throw new Error('App still running'); });
  assert.throws(() => cli.restore(f.state), /App still running/);
  assert.equal(remove.mock.callCount(), 1);
});

for (const phase of ['registration', 'shortcuts']) test(`failed ${phase} restores the prior generation and existing identity without the old source`, async t => {
  const f = fixture(t);
  const next = f.generation();
  fs.rmSync(f.source, { recursive: true });
  t.mock.method(store, 'install', async () => {
    store.saveJson(store.activePath(f.state), next.record);
    return { status: 'installed', app: next.app, source: f.source };
  });
  const rollback = t.mock.method(identity, 'registerExisting', app => {
    assert.equal(app, f.first.app);
    assert.deepEqual(store.checkedActive(f.state), f.first.record);
  });
  await assert.rejects(launcher.install(f.source, f.state, {}, {
    register() { if (phase === 'registration') throw new Error('registration failed'); },
    configureShortcuts() { throw new Error('shortcuts failed'); },
  }), new RegExp(`${phase} failed`));
  assert.equal(rollback.mock.callCount(), 1);
  assert.deepEqual(store.checkedActive(f.state), f.first.record);
  assert.equal(fs.existsSync(f.first.app), true);
});

test('failed first registration removes the unusable active pointer without affecting other states', async t => {
  const f = fixture(t);
  fs.unlinkSync(store.activePath(f.state));
  t.mock.method(store, 'install', async () => {
    store.saveJson(store.activePath(f.state), f.first.record);
    return { status: 'installed', app: f.first.app };
  });
  const remove = t.mock.method(identity, 'remove', prepared => {
    assert.equal(prepared.state, f.state);
    assert.deepEqual(prepared.roots, [f.first.root]);
  });
  await assert.rejects(launcher.install(f.source, f.state, {}, {
    register() { throw new Error('another state owns the identity'); },
  }), /another state owns/);
  assert.equal(store.checkedActive(f.state), null);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(fs.existsSync(f.first.app), true);
});

test('opening a stopped current generation repairs identity before activation without reinstalling', async t => {
  const f = fixture(t), calls = [];
  const result = await cli.launch(f.state, f.source, {
    processes: () => [], same: () => true, verify: () => {},
    install: () => assert.fail('a current copy does not need patching again'),
    prepareOpen(app, source) {
      assert.equal(app, f.first.app);
      assert.equal(source, f.source);
      calls.push('identity');
    },
    open(app) { assert.equal(app, f.first.app); calls.push('open'); },
  });
  assert.equal(result.status, 'opened');
  assert.deepEqual(calls, ['identity', 'open']);
});

for (const restart of [false, true]) test(`failed activation restores the previous identity before reopening (restart=${restart})`, async t => {
  const f = fixture(t), next = f.generation(), calls = [];
  t.mock.method(identity, 'registerExisting', app => {
    assert.equal(app, f.first.app);
    assert.deepEqual(store.checkedActive(f.state), f.first.record);
    calls.push('identity');
  });
  await assert.rejects(cli.launch(f.state, f.source, {
    restart, preflight: async () => {}, processes: () => [], verify: () => {}, same: app => app !== f.source,
    install: async () => {
      store.saveJson(store.activePath(f.state), next.record);
      return { status: 'installed', app: next.app };
    },
    open(app) {
      if (app === next.app) { calls.push('new'); throw new Error('Activation failed'); }
      assert.equal(app, f.first.app);
      assert.deepEqual(store.checkedActive(f.state), f.first.record);
      calls.push('old');
    },
  }), /Activation failed/);
  assert.deepEqual(calls, ['new', 'identity', 'old']);
});

for (const restart of [false, true]) for (const reopened of ['new', 'source']) {
  test(`activation failure retains registration when ${reopened} is running (restart=${restart})`, async t => {
    const f = fixture(t), next = f.generation();
    let attempted = false;
    t.mock.method(launcher, 'restorePrevious', () => assert.fail('must not change a running package identity'));
    await assert.rejects(cli.launch(f.state, f.source, {
      restart, preflight: async () => {}, verify: () => {}, same: app => app !== f.source,
      processes(apps) {
        if (!attempted) return [];
        const app = reopened === 'new' ? next.app : f.source;
        assert.equal(apps.includes(app), true);
        return [{ path: platform.binaryPath(app) }];
      },
      install: async () => {
        store.saveJson(store.activePath(f.state), next.record);
        return { status: 'installed', app: next.app };
      },
      open(app) {
        assert.equal(app, next.app);
        assert.equal(attempted, false);
        attempted = true;
        throw new Error('Activation failed');
      },
    }), /Activation failed/);
    assert.deepEqual(store.checkedActive(f.state), next.record);
  });
}

test('first-install activation failure removes its local identity and opens the official app', async t => {
  const f = fixture(t), calls = [];
  fs.unlinkSync(store.activePath(f.state));
  t.mock.method(identity, 'registerExisting', () => assert.fail('there is no previous local package'));
  t.mock.method(identity, 'remove', prepared => {
    assert.equal(prepared.state, f.state);
    assert.deepEqual(prepared.roots, [f.first.root]);
    assert.equal(store.checkedActive(f.state), null);
    calls.push('remove');
  });
  await assert.rejects(cli.launch(f.state, f.source, {
    restart: true, preflight: async () => {}, processes: () => [],
    install: async () => {
      store.saveJson(store.activePath(f.state), f.first.record);
      return { status: 'installed', app: f.first.app };
    },
    open(app) {
      if (app === f.first.app) { calls.push('new'); throw new Error('Activation failed'); }
      assert.equal(app, f.source);
      calls.push('official');
    },
  }), /Activation failed/);
  assert.deepEqual(calls, ['new', 'remove', 'official']);
});

test('launch does not repeat installation rollback when installation itself fails', async t => {
  const f = fixture(t), opened = [];
  t.mock.method(launcher, 'restorePrevious', () => assert.fail('the installer already handles its rollback'));
  await assert.rejects(cli.launch(f.state, f.source, {
    processes: () => [], verify: () => {}, same: app => app !== f.source,
    install: async () => { throw new Error('Registration failed'); },
    open: app => opened.push(app),
  }), /Registration failed/);
  assert.deepEqual(opened, [f.first.app]);
});
