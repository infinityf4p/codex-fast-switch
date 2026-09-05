const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const tx = require('../lib/transaction.cjs');
const automatic = require('../automatic.cjs');
const { assertStopped, discoverApp } = require('../lib/platform.cjs');
const stubCheck = async () => ({ passed: true, testStub: true });
const results = [];
async function main() {
  if (process.argv[2] === 'crash-child') {
    return tx.withLock(process.argv[4], () => tx.install(process.argv[3], process.argv[4], {
      check: stubCheck, onPhase: phase => { if (phase === process.argv[5]) process.exit(86); },
    }));
  }
  const origin = discoverApp(process.env.CODEX_FAST_TEST_APP);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-automatic-transactions-'));
  const app = path.join(root, 'ChatGPT.app');
  const state = path.join(root, 'state');
  const before = tx.fingerprint(origin);
  execFileSync('/bin/cp', ['-cR', origin, app]);
  const test = async (name, fn) => { await fn(); results.push({ name, passed: true }); console.log(name); };
  try {
    await test('Running official app is protected without mutation', () => {
      try { assertStopped(origin); } catch (error) { assert.match(error.message, /running/); }
      assert.deepEqual(tx.fingerprint(origin), before);
    });
    await test('Health-check failure leaves the complete official app untouched', async () => {
      await assert.rejects(tx.install(app, state, { check: async () => { throw new Error('simulated health failure'); } }), /simulated health failure/);
      assert.deepEqual(tx.fingerprint(app), before);
      tx.verify(app, true);
    });
    for (const phase of ['prepared', 'exchanged', 'activated']) {
      await test(`Failure at ${phase} atomically restores the exact original app`, async () => {
        await assert.rejects(tx.install(app, state, { check: stubCheck, onPhase: current => {
          if (current === phase) throw new Error(`simulated ${phase} failure`);
        } }), /simulated/);
        assert.deepEqual(tx.fingerprint(app), before);
        assert.equal(tx.checkedRecord(state, app).phase, phase === 'prepared' ? 'failed-before-activation' : 'rolled-back');
        tx.verify(app, true);
      });
    }
    for (const phase of ['prepared', 'exchanged', 'activated']) {
      await test(`Process interruption at ${phase} is recovered on the next monitor run`, async () => {
        const child = spawnSync(process.execPath, [__filename, 'crash-child', app, state, phase], { encoding: 'utf8' });
        assert.equal(child.status, 86, child.stderr);
        assert.equal(tx.marker(app)?.patchId, phase === 'prepared' ? undefined : tx.PATCH_ID);
        tx.saveJson(automatic.configPath(state), { enabled: true, app });
        const notices = [];
        assert.equal((await automatic.tick(state, { notifyUser: value => notices.push(value) })).status, 'recovered');
        assert.equal(notices.length, 1);
        assert.deepEqual(tx.fingerprint(app), before);
        tx.verify(app, true);
      });
    }
    await test('Successful install and repeated install are idempotent', async () => {
      assert.equal((await tx.install(app, state, { check: stubCheck })).status, 'installed');
      assert.equal((await tx.install(app, state, { check: stubCheck })).status, 'already-installed');
      tx.verify(app);
    });
    await test('Rollback refuses to overwrite a subsequent app change', () => {
      const file = path.join(app, 'Contents/Info.plist');
      const original = fs.readFileSync(file);
      fs.appendFileSync(file, '\n<!-- simulated updater edit -->\n');
      try { assert.throws(() => tx.restore(app, state), /changed since patching/); }
      finally { fs.writeFileSync(file, original); }
    });
    await test('Manual restore recovers the full official signature and is idempotent', () => {
      assert.equal(tx.restore(app, state).status, 'restored');
      assert.deepEqual(tx.fingerprint(app), before);
      tx.verify(app, true);
      assert.equal(tx.restore(app, state).status, 'already-restored');
    });
    await test('The real installed app remains byte-identical after all tests', () => assert.deepEqual(tx.fingerprint(origin), before));
    console.log(JSON.stringify({ testedAt: new Date().toISOString(),
      tests: results, faultInjection: true, healthChecks: 'Stubbed to exercise transaction failures; actual UI verification is tested separately.',
      productionAppModified: false, serverModified: false }, null, 2));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
