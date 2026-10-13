const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('../../src/platforms/windows/store-catalog.cjs');
const { checkForUpdates } = require('../../src/platforms/windows/updates.cjs');
const cleanup = require('../../src/platforms/windows/cleanup.cjs');

function pkg(version, arch = 'x64', minimum = '10.0.19041.0') {
  return { PackageFullName: `OpenAI.Codex_${version}_${arch}__2p2nqsd0c76g0`,
    PackageFamilyName: 'OpenAI.Codex_2p2nqsd0c76g0', Architectures: [arch],
    PlatformDependencies: [{ PlatformName: 'Windows.Desktop', MinVersion: catalog.version(minimum).toString() }] };
}
const response = packages => ({ Products: [{ ProductId: '9PLM9XGG6VKS',
  DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: packages } } }] }] });

test('Store discovery compares package versions numerically and selects only a compatible official architecture', () => {
  const bytes = response([pkg('26.915.4065.0'), pkg('26.1007.2314.0'), pkg('26.1007.2314.0'),
    pkg('27.1.0.0', 'arm64'), pkg('28.0.0.0', 'x64', '11.0.0.0'),
    { ...pkg('29.0.0.0'), PackageFamilyName: 'Other.Publisher' },
    { ...pkg('30.0.0.0'), PackageFullName: 'Other.App_30.0.0.0_x64__other' }]);
  assert.equal(catalog.latestVersion(bytes, 'x64', '10.0.26100.1'), '26.1007.2314.0');
  assert.equal(catalog.latestVersion(bytes, 'arm64', '10.0.26100.1'), '27.1.0.0');
  assert.throws(() => catalog.latestVersion(response([]), 'x64', '10.0.26100.1'), /no compatible/);
  assert.throws(() => catalog.latestVersion({ Products: [] }, 'x64', '10.0.26100.1'), /official app/);
  for (const invalid of ['26.1.2', '26.1.2.65536', '../other', null]) assert.throws(() => catalog.version(invalid), /Invalid/);
});

function fixture(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-catalog-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  let time = 1000, requests = 0, offline = false;
  const context = { market: 'CN', osVersion: '10.0.26100.1',
    packages: [{ app: 'C:\\Official\\app', version: '26.915.4065.0', arch: 'x64' }] };
  const options = { now: () => time, realpath: value => value,
    native(action, data) {
      if (action === 'store-context') return context;
      assert.equal(action, 'store-catalog'); assert.deepEqual(data, { market: context.market });
      requests++;
      if (offline) throw new Error('Network unavailable');
      return response([pkg('26.1007.2314.0')]);
    } };
  return { state, context, options, check: (extra = {}) => catalog.check(state, 'c:\\official\\app', { ...options, ...extra }),
    set time(value) { time = value; }, set offline(value) { offline = value; }, get requests() { return requests; } };
}

test('Store checks cache successful requests, force a manual refresh and invalidate after an official installation', t => {
  const f = fixture(t);
  assert.equal(f.check().status, 'available');
  assert.equal(f.check().version, '26.1007.2314.0');
  assert.equal(f.requests, 1);
  f.check({ force: true }); assert.equal(f.requests, 2);
  f.time = 1801001; f.check(); assert.equal(f.requests, 3);
  f.context.packages[0].version = '26.1007.2314.0';
  assert.equal(f.check().status, 'current'); assert.equal(f.requests, 4);
  f.context.market = 'US'; f.check(); assert.equal(f.requests, 5);
  assert.ok(cleanup.plan(f.state).targets.includes(catalog.cachePath(f.state)));
});

test('offline checks are unknown, back off, retry on demand and retain previously observed updates', t => {
  const f = fixture(t);
  f.offline = true;
  assert.equal(f.check().status, 'unknown');
  assert.equal(f.check().status, 'unknown'); assert.equal(f.requests, 1);
  f.time = 121001;
  assert.equal(f.check().status, 'unknown'); assert.equal(f.requests, 2);
  f.offline = false;
  assert.equal(f.check({ force: true }).status, 'available');
  f.offline = true;
  const cached = f.check({ force: true });
  assert.equal(cached.status, 'available'); assert.equal(cached.stale, true);
  assert.equal(f.check().status, 'available');
  // Updating the official package must invalidate a stale positive result as well.
  f.context.packages[0].version = '26.1007.2314.0';
  assert.equal(f.check().status, 'unknown');
});

test('custom sources do not trigger Store checks and malformed cache does not suppress a fresh request', t => {
  const f = fixture(t);
  assert.equal(catalog.check(f.state, 'C:\\Other\\app', f.options).status, 'unmanaged');
  assert.equal(f.requests, 0);
  fs.writeFileSync(catalog.cachePath(f.state), '{broken');
  assert.equal(f.check().status, 'available');
});

test('native readiness includes online releases but local updates remain available when the Store is offline', () => {
  for (const localAvailable of [false, true]) {
    for (const status of ['available', 'current', 'unknown', 'unmanaged']) {
      const result = checkForUpdates('state', 'id', { force: true,
        localCheck: () => ({ available: localAvailable, source: 'official', version: 'app-version' }),
        officialCheck(state, source, options) {
          assert.equal(state, 'state'); assert.equal(source, 'official'); assert.equal(options.force, true);
          return { status };
        } });
      assert.equal(result.available, localAvailable || status === 'available');
      assert.equal(result.localAvailable, localAvailable);
      assert.equal(result.version, 'app-version');
    }
  }
});
