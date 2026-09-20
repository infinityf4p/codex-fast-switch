const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const identity = require('../../src/platforms/windows/identity.cjs');
const index = require('../../src/platforms/windows/package-icons.json');

function fixture(t) {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-identity-icons-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 }));
  const source = path.join(temporary, 'official', 'app');
  const originalAssets = path.join(path.dirname(source), 'assets');
  const root = path.join(temporary, 'generation');
  const app = path.join(root, 'app');
  for (const directory of [source, originalAssets, app]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(app, 'owl-shell-runtime.json'), JSON.stringify({ arch: 'x64' }));
  for (const name of index.assets) fs.writeFileSync(path.join(originalAssets, name), `official-image:${name}`);
  const assets = path.join(root, 'assets');
  const pri = path.join(root, 'resources.pri');
  const registered = { packageFullName: 'test-package', packageFamilyName: 'test-family', installLocation: root };
  return { temporary, source, originalAssets, root, app, assets, pri, registered };
}

test('local package registration receives all official theme and size candidates with their resource index', t => {
  const f = fixture(t);
  const futureImage = 'Square44x44Logo.targetsize-128_altform-unplated.png';
  fs.writeFileSync(path.join(f.originalAssets, futureImage), 'another official resolution');
  fs.writeFileSync(path.join(f.originalAssets, 'unrelated.png'), 'not an application icon');
  let calls = 0;
  const result = identity.ensure(f.app, f.source, { run(action, payload) {
    calls++;
    assert.equal(action, 'identity');
    assert.equal(payload.root, f.root);
    assert.equal(payload.refresh, true);
    for (const name of [...index.assets, futureImage]) {
      assert.deepEqual(fs.readFileSync(path.join(f.assets, name)), fs.readFileSync(path.join(f.originalAssets, name)));
    }
    assert.equal(fs.existsSync(path.join(f.assets, 'unrelated.png')), false);
    assert.deepEqual(fs.readFileSync(f.pri), fs.readFileSync(path.join(__dirname, '../../src/platforms/windows/package-icons.pri')));
    assert.match(fs.readFileSync(path.join(f.root, 'AppxManifest.xml'), 'utf8'), /Square44x44Logo="assets\\Square44x44Logo\.png"/);
    return f.registered;
  } });
  assert.equal(calls, 1);
  assert.equal(result.indexedIcons, true);
  assert.equal(result.activation, 'test-family!App');
});

test('unchanged identity resources are not rewritten and do not request registration refresh', t => {
  const f = fixture(t);
  identity.ensure(f.app, f.source, { run: () => f.registered });
  const files = [path.join(f.root, 'AppxManifest.xml'), f.pri, ...index.assets.map(name => path.join(f.assets, name))];
  for (const file of files) fs.utimesSync(file, new Date('2001-02-03T04:05:06Z'), new Date('2001-02-03T04:05:06Z'));
  const before = files.map(file => ({ bytes: fs.readFileSync(file), modified: fs.statSync(file).mtimeMs }));
  let calls = 0;
  identity.ensure(f.app, f.source, { run(action, payload) {
    calls++;
    assert.equal(action, 'identity');
    assert.equal(payload.refresh, false);
    return f.registered;
  } });
  assert.equal(calls, 1);
  files.forEach((file, i) => {
    assert.deepEqual(fs.readFileSync(file), before[i].bytes);
    assert.equal(fs.statSync(file).mtimeMs, before[i].modified);
  });
});

test('changed base and theme artwork replace stale bytes before the package is refreshed', t => {
  const f = fixture(t);
  identity.ensure(f.app, f.source, { run: () => f.registered });
  const changed = ['Square44x44Logo.png', 'Square44x44Logo.targetsize-32_altform-lightunplated.png'];
  for (const name of changed) fs.writeFileSync(path.join(f.originalAssets, name), `updated-official-image:${name}`);
  identity.ensure(f.app, f.source, { run(_action, payload) {
    assert.equal(payload.refresh, true);
    for (const name of changed) assert.deepEqual(fs.readFileSync(path.join(f.assets, name)), fs.readFileSync(path.join(f.originalAssets, name)));
    return f.registered;
  } });
});

test('failed registration keeps a pending refresh until a later attempt succeeds', t => {
  const f = fixture(t);
  const marker = path.join(f.root, '.identity-refresh-pending');
  assert.throws(() => identity.ensure(f.app, f.source, { run(_action, payload) {
    assert.equal(payload.refresh, true);
    assert.equal(fs.readFileSync(marker, 'utf8'), `${identity.PACKAGE_NAME}\n`);
    throw new Error('Temporary registration failure');
  } }), /Temporary registration failure/);
  assert.equal(fs.existsSync(marker), true);
  const priBefore = fs.readFileSync(f.pri);
  identity.ensure(f.app, f.source, { run(_action, payload) {
    assert.equal(payload.refresh, true);
    assert.equal(fs.existsSync(marker), true);
    assert.deepEqual(fs.readFileSync(f.pri), priBefore);
    return f.registered;
  } });
  assert.equal(fs.existsSync(marker), false);
  identity.ensure(f.app, f.source, { run(_action, payload) {
    assert.equal(payload.refresh, false);
    assert.equal(fs.existsSync(marker), false);
    return f.registered;
  } });
});

test('refresh markers must be regular files before resources are changed', async t => {
  for (const kind of ['directory', 'junction']) await t.test(kind, t => {
    const f = fixture(t);
    const marker = path.join(f.root, '.identity-refresh-pending');
    if (kind === 'directory') fs.mkdirSync(marker);
    else {
      const outside = path.join(f.temporary, 'unrelated-directory');
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, marker, 'junction');
    }
    assert.throws(() => identity.ensure(f.app, f.source, { run: () => assert.fail('must not register with a redirected marker') }), /refresh marker is redirected/);
    assert.equal(fs.existsSync(path.join(f.root, 'AppxManifest.xml')), false);
    assert.equal(fs.existsSync(f.assets), false);
    assert.equal(fs.existsSync(f.pri), false);
  });
});

test('a missing qualified candidate keeps base icons and removes only this tools obsolete resource index', t => {
  const f = fixture(t);
  const missing = 'Square44x44Logo.targetsize-32_altform-lightunplated.png';
  fs.unlinkSync(path.join(f.originalAssets, missing));
  let refresh;
  const run = (_action, payload) => { refresh = payload.refresh; return f.registered; };
  assert.equal(identity.ensure(f.app, f.source, { run }).indexedIcons, false);
  assert.equal(fs.existsSync(f.pri), false);
  assert.equal(fs.readFileSync(path.join(f.assets, 'Square44x44Logo.png'), 'utf8'), 'official-image:Square44x44Logo.png');
  fs.writeFileSync(path.join(f.originalAssets, missing), 'restored official candidate');
  assert.equal(identity.ensure(f.app, f.source, { run }).indexedIcons, true);
  fs.unlinkSync(path.join(f.originalAssets, missing));
  assert.equal(identity.ensure(f.app, f.source, { run }).indexedIcons, false);
  assert.equal(refresh, true);
  assert.equal(fs.existsSync(f.pri), false);
  identity.ensure(f.app, f.source, { run });
  assert.equal(refresh, false);
  const otherIndex = Buffer.from('unrelated pre-existing resource index');
  fs.writeFileSync(f.pri, otherIndex);
  assert.equal(identity.ensure(f.app, f.source, { run }).indexedIcons, false);
  assert.deepEqual(fs.readFileSync(f.pri), otherIndex);
  assert.equal(refresh, false);
});

test('missing basic artwork stops before publishing a resource index or registering the package', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.originalAssets, 'Square150x150Logo.png'));
  assert.throws(() => identity.ensure(f.app, f.source, { run: () => assert.fail('must not register an incomplete package') }), /missing assets/);
  assert.equal(fs.existsSync(f.pri), false);
  assert.deepEqual(fs.readdirSync(f.assets), []);
});

test('redirected source and destination asset directories are rejected without touching their contents', async t => {
  for (const redirected of ['source', 'destination']) await t.test(redirected, t => {
    const f = fixture(t);
    const outside = path.join(f.temporary, 'redirected-assets');
    const link = redirected === 'source' ? f.originalAssets : f.assets;
    if (redirected === 'source') fs.renameSync(f.originalAssets, outside);
    else fs.mkdirSync(outside);
    const sentinel = path.join(outside, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'unchanged');
    const before = fs.readdirSync(outside);
    fs.symlinkSync(outside, link, 'junction');
    assert.throws(() => identity.ensure(f.app, f.source, { run: () => assert.fail('must not register redirected resources') }), /redirected|symbolic|junction/i);
    assert.deepEqual(fs.readdirSync(outside), before);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
    assert.equal(fs.existsSync(f.pri), false);
  });
});
