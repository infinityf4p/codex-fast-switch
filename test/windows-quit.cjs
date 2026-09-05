const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const platform = require('../windows/platform.cjs');
const { CdpSocket } = require('../windows/cdp.cjs');
const { probeEnvironment, probeConfig, stopChild } = require('../lib/probe.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  platform.requireWindows();
  if (!process.argv[2]) throw new Error('Pass a prepared local test copy as the first argument.');
  const app = platform.normalizeApp(process.argv[2]);
  if (!fs.existsSync(path.join(app, 'resources/codex-fast-switch.json'))) throw new Error('Select a patched test copy, not the original app.');
  platform.verify(app, { patched: true });
  platform.assertStopped([app]);
  const source = platform.discoverApp();
  assert.notEqual(app.toLowerCase(), source.toLowerCase());
  const originals = platform.processes([source]).map(item => item.pid);
  assert.ok(originals.length, 'Keep the original app running during this test.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-quit-'));
  const userData = path.join(root, 'profile');
  for (const directory of ['codex', 'AppData/Roaming', 'AppData/Local']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [], models: [] }));
  });
  let child, closed, cdp;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(root, 'codex/auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-local-fast-probe-only' }));
    fs.writeFileSync(path.join(root, 'codex/config.toml'), probeConfig(server.address().port));
    const log = fs.openSync(path.join(root, 'app.log'), 'w');
    child = spawn(platform.binaryPath(app), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userData}`, '--lang=en-US'], { cwd: root, env: probeEnvironment(root), stdio: ['ignore', log, log], windowsHide: false });
    fs.closeSync(log);
    closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    cdp = await CdpSocket.connect(child, userData);
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const { targetInfos } = await cdp.call('Target.getTargets');
      const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('app:') && !item.url.includes('avatar-overlay'));
      if (target) {
        const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        try {
          const result = await cdp.call('Runtime.evaluate', { expression: '(document.body?.innerText?.length ?? 0) > 50', returnByValue: true }, sessionId);
          ready = result.result.value === true;
          if (ready) await cdp.call('Page.bringToFront', {}, sessionId);
        } finally { await cdp.call('Target.detachFromTarget', { sessionId }); }
      }
      if (!ready) await delay(500);
    }
    assert.ok(ready, `Test window did not become ready. Logs: ${root}`);
    const closeToTray = process.argv.includes('--close-to-tray');
    if (closeToTray) {
      const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const requested = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        `[Diagnostics.Process]::GetProcessById(${child.pid}).CloseMainWindow()`], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' }).trim();
      assert.equal(requested, 'True', 'The close-to-tray fixture did not receive a window close request.');
      await delay(1000);
      assert.equal(child.exitCode, null, 'This fixture must reproduce the window-close-to-tray behavior.');
      console.log('Window close left the test app running, reproducing the reported failure.');
    }
    platform.native('quit', { binaries: [platform.binaryPath(app)] },
      { env: { ...probeEnvironment(root), ProgramFiles: process.env.ProgramFiles } });
    await Promise.race([closed, delay(30000)]);
    assert.notEqual(child.exitCode, null, `Ctrl+Q did not exit the test copy. Logs: ${root}`);
    for (const pid of originals) assert.ok(platform.processes([source]).some(item => item.pid === pid), 'An original process was closed.');
    console.log(JSON.stringify({ passed: true, windowCloseKeptRunning: closeToTray, shortcutExited: true,
      isolatedProfile: true, originalStillRunning: true, exitCode: child.exitCode }, null, 2));
  } finally {
    if (cdp && !cdp.closed) {
      try { await cdp.call('Browser.close'); } catch {}
      cdp.close();
    }
    if (child) await stopChild(child, closed);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); }
    catch { console.error(`Temporary test files are still in use: ${root}`); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
