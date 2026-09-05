const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const tx = require('../lib/transaction.cjs');
const automatic = require('../automatic.cjs');
const { discoverApp } = require('../lib/platform.cjs');
const { healthCheck } = require('../lib/health.cjs');
const { cleanupSigningIdentity } = require('./signing-fixtures.cjs');

async function main() {
  const origin = discoverApp(process.env.CODEX_FAST_TEST_APP);
  tx.verify(origin, true);
  const original = tx.fingerprint(origin);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-e2e-'));
  const app = path.join(root, 'Test Codex.app');
  const state = path.join(root, 'state');
  execFileSync('/bin/cp', ['-cR', origin, app]);
  fs.mkdirSync(state);
  tx.saveJson(automatic.configPath(state), { enabled: true, app });
  try {
    const start = Date.now();
    const options = { now: start, notifyUser: message => console.log(JSON.stringify({ notice: message })),
      install: (target, stateDir) => tx.install(target, stateDir, {
        check: (candidate, options) => healthCheck(candidate, { ...options,
          screenshot: process.env.CODEX_FAST_TEST_SCREENSHOT,
          model: process.env.CODEX_FAST_TEST_MODEL,
          reasoningEffort: process.env.CODEX_FAST_TEST_REASONING_EFFORT,
          modelLabel: process.env.CODEX_FAST_TEST_MODEL_LABEL,
          verifyCompactControl: process.env.CODEX_FAST_TEST_COMPACT_UI === '1',
          compactScreenshot: process.env.CODEX_FAST_TEST_COMPACT_SCREENSHOT,
          colorScheme: process.env.CODEX_FAST_TEST_COLOR_SCHEME }),
        onPhase: (phase, detail) => console.log(JSON.stringify({ phase, detail })),
      }) };
    const installed = await automatic.tick(state, options);
    assert.equal(installed.status, 'installed', installed.error);
    assert.equal(tx.marker(app).patchId, tx.PATCH_ID);
    const health = installed.result.health;
    const requests = health.requests.filter(request => request.model === health.model);
    assert.deepEqual(requests.map(request => request.service_tier), ['priority', null]);
    assert.equal((await automatic.tick(state, options)).status, 'idle');
    assert.equal(tx.restore(app, state).status, 'restored');
    assert.deepEqual(tx.fingerprint(app), original);
    tx.verify(app, true);
    const report = { testedAt: new Date().toISOString(), architecture: process.arch, originalVersion: tx.version(app),
      automaticInstallationPassed: true, health, gateCases: installed.result.checks,
      restoredOriginalSignature: true, installedAppUnchanged: true };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    assert.deepEqual(tx.fingerprint(origin), original);
    cleanupSigningIdentity(state);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
