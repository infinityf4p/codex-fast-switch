const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const asar = require('@electron/asar');
const walk = require('acorn-walk');
const { spawn, execFileSync } = require('node:child_process');
const platform = require('../../../src/platforms/windows/platform.cjs');
const store = require('../../../src/platforms/windows/store.cjs');
const launcher = require('../../../src/platforms/windows/launcher.cjs');
const updates = require('../../../src/platforms/windows/updates.cjs');
const { probeEnvironment, probeConfig, discoverModel, stopChild } = require('../../support/probe.cjs');
const { CdpSocket } = require('../../support/cdp-socket.cjs');
const { parse } = require('../../../src/core/adaptive.cjs');
const { patchArchive } = require('../../../src/core/archive.cjs');
const integrity = require('../../../src/platforms/windows/integrity.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;

function nativeProcesses(root, stop = false) {
  // Cleanup only processes whose executable is inside this freshly created test directory.
  const payload = Buffer.from(JSON.stringify({ root, stop })).toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($data.root).TrimEnd('\\')
if ($data.stop -and (-not ([IO.Path]::GetFileName($root).StartsWith('codex-fast-update-')) -or
    -not (Test-Path -LiteralPath (Join-Path $root 'test-owned.json')))) { throw 'Not an owned test directory.' }
$items = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith(($root + '\\'), [StringComparison]::OrdinalIgnoreCase)
})
if ($data.stop) {
    foreach ($item in $items) {
        $current = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $item.ProcessId)
        if ($current -and $current.ExecutablePath -eq $item.ExecutablePath -and $current.CreationDate -eq $item.CreationDate) {
            Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}
ConvertTo-Json -InputObject @($items | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate) -Compress
`;
  return JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim().replace(/^\uFEFF/, ''));
}

async function snapshotInstalled(previousState, state) {
  const previous = store.checkedActive(previousState);
  assert.ok(previous && platform.same(previous.app, previous.patched), 'Previous copy must match its installation record.');
  platform.verify(previous.app, { patched: true });
  const id = Date.now() + '-' + crypto.randomUUID();
  const directory = path.join(state, 'versions', id), app = path.join(directory, 'app');
  fs.mkdirSync(directory, { recursive: true });
  store.copyApp(previous.app, app);
  const archive = platform.archivePath(app), originalHeader = integrity.headerHash(app), targets = [];
  for (const entry of asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
    .filter(file => file.startsWith('.vite/build/') && file.endsWith('.js'))) {
    const source = asar.extractFile(archive, path.normalize(entry)).toString('utf8');
    if (!source.includes('initializeWindowsUpdater')) continue;
    walk.simple(parse(source), { MethodDefinition(method) {
      if (method.key.name !== 'initializeWindowsUpdater') return;
      const assignment = method.value.body.body[0]?.expression;
      const binding = assignment?.right?.arguments?.[1];
      if (assignment?.left?.object?.type !== 'ThisExpression' || assignment.left.property?.name !== 'updater' ||
        binding?.type !== 'ObjectExpression') throw new Error('Previous copy has an unrecognized updater binding.');
      const value = JSON.parse(source.slice(binding.start, binding.end));
      assert.equal(value.id, previous.id);
      assert.equal(path.resolve(value.state), path.resolve(previousState));
      targets.push({ entry, source, binding });
    } });
  }
  assert.equal(targets.length, 1);
  const { entry, source, binding } = targets[0];
  patchArchive(archive, entry, () => Buffer.from(source.slice(0, binding.start) + JSON.stringify({ state, id }) + source.slice(binding.end)));
  const record = { ...previous, id, app, integrity: integrity.patch(app, originalHeader), patched: platform.fingerprint(app) };
  store.saveJson(path.join(app, 'resources/codex-fast-switch.json'), { patchId: store.PATCH_ID, revision: record.revision, id,
    archiveSha256: record.patched['resources/app.asar'], checks: record.checks });
  platform.verify(app, { patched: true });
  store.saveJson(path.join(directory, 'record.json'), record);
  store.saveJson(store.activePath(state), record);
  launcher.prepare(state);
  return record;
}

async function run(source, artifacts, previousState) {
  platform.requireWindows();
  source = platform.discoverApp(source);
  platform.assertStopped([source]);
  artifacts = path.resolve(artifacts);
  fs.mkdirSync(artifacts, { recursive: true });
  const protectedState = platform.DEFAULT_STATE;
  const protectedFiles = [store.activePath(protectedState), store.configPath(protectedState),
    path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/ChatGPT.lnk')];
  const before = { hashes: protectedFiles.map(hash), processes: nativeProcesses(protectedState) };
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-update-')));
  fs.writeFileSync(path.join(root, 'test-owned.json'), JSON.stringify({ pid: process.pid, root }));
  const state = path.join(root, 'state');
  const snapshot = path.join(root, 'official-snapshot');
  const profile = path.join(root, 'profile');
  const home = path.join(root, 'codex');
  for (const dir of [state, profile, home, 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs', 'AppData/Local', 'Desktop']) {
    fs.mkdirSync(path.isAbsolute(dir) ? dir : path.join(root, dir), { recursive: true });
  }
  const env = { ...probeEnvironment(root), ProgramFiles: process.env.ProgramFiles };
  const progress = value => console.log(JSON.stringify(value));
  const report = { passed: false, source: platform.metadata(source), root, artifacts,
    trigger: previousState ? 'previous installed Fast copy to a newer official app' : 'same-version official snapshot at a different source path',
    officialDownloadTested: false, modelEndpoint: 'loopback-mock' };
  const diagnostics = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      if (!body || !req.url.endsWith('/responses')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [], models: [] }));
        return;
      }
      const id = crypto.randomUUID();
      const item = { id: 'msg_' + id, type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: 'UPDATE_TEST_OK', annotations: [] }] };
      const response = { id: 'resp_' + id, object: 'response', created_at: Math.floor(Date.now() / 1000),
        status: 'completed', model: body.model, output: [item],
        usage: { input_tokens: 1, output_tokens: 3, total_tokens: 4 } };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
      for (const event of [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
        { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'UPDATE_TEST_OK' },
        { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }]) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch { res.writeHead(400); res.end(); }
  });
  let child, closed, cdp, session;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-local-fast-probe-only' }));
    fs.writeFileSync(path.join(home, 'config.toml'), probeConfig(server.address().port));
    fs.writeFileSync(path.join(profile, 'update-test-marker'), root);
    progress({ phase: previousState ? 'copying-previous-fast-version' : 'copying-official-snapshot', root });
    if (!previousState) store.copyApp(source, snapshot);
    const initial = previousState ? await snapshotInstalled(previousState, state) :
      await launcher.install(snapshot, state, { onPhase: phase => progress({ phase }) });
    const model = await discoverModel(initial.app, root);
    fs.writeFileSync(path.join(home, 'config.toml'), probeConfig(server.address().port, model));
    const initialRecord = store.checkedActive(state);
    report.initial = { version: initialRecord.version, build: initialRecord.build, revision: initialRecord.revision };
    // The updater discovers an actual signed source change without changing app version metadata or UI state.
    store.saveJson(store.configPath(state), { source, autoDiscover: false, enabled: false });
    assert.equal(updates.check(state, initialRecord.id).available, true);
    const log = fs.openSync(path.join(artifacts, 'app.log'), 'w');
    child = spawn(platform.binaryPath(initial.app), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, '--lang=en-US'], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    report.initialPid = child.pid;
    cdp = await CdpSocket.connect(child, profile);
    const sessions = new Set();
    cdp.on('message', message => {
      if (message.method === 'Target.attachedToTarget') {
        sessions.add(message.params.sessionId);
        progress({ phase: 'attached', url: message.params.targetInfo.url });
        cdp.call('Runtime.enable', {}, message.params.sessionId).catch(() => {});
        cdp.call('Log.enable', {}, message.params.sessionId).catch(() => {});
        cdp.call('Runtime.runIfWaitingForDebugger', {}, message.params.sessionId).catch(() => {});
      }
      if (message.method === 'Target.detachedFromTarget') sessions.delete(message.params.sessionId);
      if (['Runtime.exceptionThrown', 'Log.entryAdded'].includes(message.method) && diagnostics.length < 30) diagnostics.push(message.params);
    });
    await cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: 'page' }, { exclude: true }] });
    const evaluate = async expression => {
      if (!session) return null;
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (fn, label, timeout = 90000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await fn()) return;
        await delay(500);
      }
      throw new Error('Timed out: ' + label);
    };
    const click = async selector => {
      const point = await evaluate(`(()=>{const e=${selector};if(!e||e.disabled)return null;const r=e.getBoundingClientRect();
        const x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
      if (!point) return false;
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.call('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, session);
      }
      return true;
    };
    const button = label => `Array.from(document.querySelectorAll('button')).find(e=>e.getBoundingClientRect().width>0 &&
      (e.getAttribute('aria-label')===${JSON.stringify(label)} || e.getAttribute('title')===${JSON.stringify(label)} ||
      e.textContent.trim()===${JSON.stringify(label)} || Array.from(e.querySelectorAll('span')).some(s=>s.textContent.trim()===${JSON.stringify(label)})))`;
    let lastOnboarding;
    await until(async () => {
      for (const candidate of sessions) {
        const result = await cdp.call('Runtime.evaluate', { expression:
          'location.protocol === "app:" && new URL(location.href).searchParams.get("initialRoute") !== "/avatar-overlay"',
        returnByValue: true }, candidate);
        if (result.result?.value) { session = candidate; break; }
      }
      const text = await evaluate('document.body?.innerText?.slice(0,1800)');
      if (text !== lastOnboarding) { progress({ phase: 'onboarding', text }); lastOnboarding = text; }
      if (await evaluate('!!document.querySelector("[contenteditable=true]")')) return true;
      if (await click(button('Go to ChatGPT'))) return false;
      for (const label of ['Continue with limited access', 'Skip for now', 'Skip', 'Get started', 'Continue', 'Next', 'Done', 'Start']) {
        if (await click(button(label))) return false;
      }
      await click(`Array.from(document.querySelectorAll('label,[role=option],[role=radio],span')).find(e=>e.textContent.trim()==='Engineering')`);
      return false;
    }, 'isolated app onboarding');
    await until(() => evaluate(`!!(${button('Update')})`), 'native Update button');
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png' }, session);
    fs.writeFileSync(path.join(artifacts, 'native-update.png'), Buffer.from(shot.data, 'base64'));
    report.buttonLabel = 'Update';
    progress({ phase: 'clicking-native-update', pid: child.pid });
    assert.equal(await click(button('Update')), true);
    let lastJob;
    await until(async () => {
      const job = store.readOptional(updates.jobPath(state));
      const status = JSON.stringify([job?.status, job?.phase]);
      if (status !== lastJob) { progress({ phase: 'update-job', status: job?.status, step: job?.phase }); lastJob = status; }
      if (job?.status === 'failed') throw new Error(job.error);
      return job?.status === 'installed';
    }, 'real update and relaunch', 240000);
    assert.notEqual(child.exitCode, null, 'The initial test app must finish quitting before publication.');
    const active = store.checkedActive(state);
    assert.notEqual(active.id, initialRecord.id);
    assert.equal(active.source, source);
    assert.equal(active.revision, store.PATCH_REVISION);
    platform.verify(active.app, { patched: true });
    assert.equal(updates.check(state, active.id).available, false);
    let relaunched;
    await until(() => {
      relaunched = nativeProcesses(root).find(item => item.ExecutablePath.toLowerCase() === platform.binaryPath(active.app).toLowerCase()
        && item.CommandLine?.includes(`--user-data-dir=${profile}`) && !item.CommandLine.includes('--type='));
      return Boolean(relaunched);
    }, 'new generation process with the same isolated profile');
    assert.equal(fs.readFileSync(path.join(profile, 'update-test-marker'), 'utf8'), root);
    report.relaunchedPid = relaunched.ProcessId;
    report.installed = { version: active.version, build: active.build, revision: active.revision };
    report.profilePreserved = true;
    if (previousState) {
      // Exercise the newly patched renderer and request gates after the upgrade.
      platform.requestQuit([active.app]);
      await until(() => !platform.processes([active.app]).length, 'updated test app exits before the request probe');
      report.fastMode = await require('../../support/health.cjs').healthCheck(active.app, { onProgress: progress,
        screenshot: path.join(artifacts, 'updated-fast-settings.png'),
        verifyCompactControl: !active.compatibility?.nativeAppearance });
    }
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    fs.writeFileSync(path.join(artifacts, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    if (cdp && !cdp.closed && session) {
      try {
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png' }, session);
        fs.writeFileSync(path.join(artifacts, 'failure.png'), Buffer.from(shot.data, 'base64'));
        const body = await cdp.call('Runtime.evaluate', { expression: 'document.body?.innerText', returnByValue: true }, session);
        fs.writeFileSync(path.join(artifacts, 'failure-ui.txt'), body.result.value || '');
        const controls = await cdp.call('Runtime.evaluate', { expression:
          'Array.from(document.querySelectorAll("button")).map(e=>e.outerHTML)', returnByValue: true }, session);
        fs.writeFileSync(path.join(artifacts, 'failure-controls.json'), JSON.stringify(controls.result.value, null, 2));
      } catch {}
    }
    throw error;
  } finally {
    if (cdp && !cdp.closed) { try { await cdp.call('Browser.close'); } catch {} cdp.close(); }
    if (child) await stopChild(child, closed);
    try {
      const cleanupDeadline = Date.now() + 15000;
      do {
        nativeProcesses(root, true);
        await delay(500);
      } while (nativeProcesses(root).length && Date.now() < cleanupDeadline);
      assert.deepEqual(nativeProcesses(root), [], 'Test processes remain running.');
      launcher.remove(state);
      assert.deepEqual(protectedFiles.map(hash), before.hashes, 'Personal installation or shortcut changed.');
      const after = nativeProcesses(protectedState);
      for (const process of before.processes.filter(item => !item.CommandLine?.includes('--type='))) {
        assert.ok(after.some(item => item.ProcessId === process.ProcessId && item.CreationDate === process.CreationDate),
          'A personal app or monitor process exited during the test.');
      }
      report.personalInstallationUnchanged = true;
      report.protectedPids = before.processes.filter(item => !item.CommandLine?.includes('--type=')).map(item => item.ProcessId);
      assert.equal(fs.realpathSync(root), root);
      assert.ok(path.basename(root).startsWith('codex-fast-update-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
      report.cleanedUp = true;
    } catch (error) { report.passed = false; report.cleanupError = error.message; process.exitCode = 1; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    progress(report);
  }
}

if (require.main === module) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node test/integration/windows/updates.cjs ORIGINAL_APP ARTIFACT_DIRECTORY [PREVIOUS_FAST_STATE]');
  run(process.argv[2], process.argv[3], process.argv[4]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
