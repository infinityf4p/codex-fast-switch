const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const tx = require('../lib/transaction.cjs');
const platform = require('../lib/platform.cjs');
const { restart } = require('../lib/restart.cjs');
const { probeEnvironment, probeConfig, discoverModel, stopChild } = require('../lib/probe.cjs');
const { CdpPipe } = require('../lib/cdp.cjs');
const { cleanupSigningIdentity } = require('./signing-fixtures.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 20000;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(100);
  }
}

async function main() {
  const origin = platform.discoverApp(process.env.CODEX_FAST_TEST_APP);
  const before = tx.fingerprint(origin);
  const originRunning = platform.isRunning(origin);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-restart-'));
  const app = path.join(root, 'Test Codex.app');
  const state = path.join(root, 'state');
  const children = [];
  let observer;
  let observerClosed;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [], models: [] }));
  });
  try {
    execFileSync('/bin/cp', ['-cR', origin, app]);
    fs.mkdirSync(path.join(root, 'codex'));
    tx.saveJson(path.join(root, 'codex/auth.json'), { OPENAI_API_KEY: 'sk-local-fast-probe-only' });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const configFile = path.join(root, 'codex/config.toml');
    fs.writeFileSync(configFile, probeConfig(server.address().port));
    const model = await discoverModel(app, root);
    fs.writeFileSync(configFile, probeConfig(server.address().port, model));
    let events = '';
    observer = spawn(path.join(__dirname, '../lib/native-helper'), ['watch', app], { stdio: ['ignore', 'pipe', 'inherit'] });
    observerClosed = new Promise(resolve => { observer.once('close', resolve); });
    observer.on('error', error => { events += error.message; });
    observer.stdout.on('data', data => { events += data; });
    await until(() => events.includes('watching'), 'exit observer startup');
    async function launch() {
      const child = spawn(platform.binaryPath(app), ['--remote-debugging-pipe', `--user-data-dir=${path.join(root, 'profile')}`, '--lang=en-US', '--use-mock-keychain'], {
        cwd: root, env: probeEnvironment(root), stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      });
      const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
      children.push({ child, closed });
      const cdp = new CdpPipe(child);
      let sessionId;
      const diagnostics = [];
      cdp.on('message', message => {
        if (['Runtime.exceptionThrown', 'Log.entryAdded'].includes(message.method)) diagnostics.push(message.params);
        if (message.method === 'Target.attachedToTarget') {
          sessionId ??= message.params.sessionId;
          cdp.call('Runtime.runIfWaitingForDebugger', {}, message.params.sessionId).catch(() => {});
        }
      });
      await cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
        filter: [{ type: 'page' }, { exclude: true }] });
      await until(() => sessionId, 'app window');
      await cdp.call('Runtime.enable', {}, sessionId);
      await cdp.call('Log.enable', {}, sessionId);
      let snapshot;
      try {
        await until(async () => {
          snapshot = (await cdp.call('Runtime.evaluate', {
            expression: '({ready:document.readyState,text:document.body?.innerText,url:location.href})', returnByValue: true,
          }, sessionId)).result.value;
          return snapshot.ready === 'complete' && snapshot.text?.length > 20;
        }, 'app finished launching');
      } catch (error) {
        console.error(JSON.stringify({ launch: children.length, snapshot, diagnostics }));
        throw error;
      }
    }
    await launch();
    const phases = [];
    const result = await tx.withLock(state, () => restart(app, state, {
      open: launch, onPhase: phase => phases.push(phase),
      quit: () => {
        const sent = execFileSync(path.join(__dirname, '../lib/native-helper'), ['quit', app], { encoding: 'utf8' });
        assert.match(sent, /quit-requested/, 'The temporary app must be registered at its own bundle path');
      },
    }));
    assert.equal(result.status, 'installed');
    assert.equal(result.reopened, true);
    assert.equal(platform.isRunning(app), true);
    assert.equal(phases.includes('health-check'), false);
    assert.equal(tx.checkedRecord(state, app).health, undefined);
    await until(() => events.includes('exited'), 'path-matched exit notification');
    platform.requestQuit(app);
    await until(() => !platform.isRunning(app), 'test app cleanup');
    assert.equal(tx.restore(app, state).status, 'restored');
    assert.deepEqual(tx.fingerprint(app), before);
    assert.deepEqual(tx.fingerprint(origin), before);
    assert.equal(platform.isRunning(origin), originRunning);
    console.log(JSON.stringify({ testedAt: new Date().toISOString(), app: tx.version(origin),
      ...result, backup: '[temporary backup removed after restoration]', phases, normalQuit: true,
      exitNotification: true, isolatedProfile: true, productionAppModified: false, serverModified: false }, null, 2));
  } finally {
    if (observer) { observer.kill('SIGTERM'); await observerClosed; }
    for (const { child, closed } of children) await stopChild(child, closed);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    cleanupSigningIdentity(state);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
