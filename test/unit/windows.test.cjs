const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const { NtExecutable, NtExecutableResource } = require('resedit');
const integrity = require('../../src/platforms/windows/integrity.cjs');
const platform = require('../../src/platforms/windows/platform.cjs');
const store = require('../../src/platforms/windows/store.cjs');
const automatic = require('../../src/platforms/windows/automatic.cjs');
const { launch } = require('../../src/platforms/windows/cli.cjs');
const { planArchive } = require('../../src/core/adaptive.cjs');
const { snippets, recipes } = require('../support/fixtures.cjs');

test('Windows PowerShell launcher resolves Node and runs the real CLI', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, '../../launchers/windows/run.ps1'), 'status', '--state', path.join(root, 'State with spaces')],
  { input: '\n', encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const status = JSON.parse(result.stdout.trim());
  assert.equal(status.configuration, null);
  assert.equal(status.active, null);
  assert.equal(fs.existsSync(path.join(root, 'State with spaces')), false);
});

test('Windows tray activation preserves explicit profile paths without forwarding other arguments', { skip: process.platform !== 'win32' }, () => {
  const cases = [
    { line: '"C:\\Program Files\\Codex\\ChatGPT.exe" --lang=en-US', expected: '' },
    { line: 'ChatGPT.exe --user-data-dir="C:\\Profiles\\A & B" --lang=en-US', expected: '"--user-data-dir=C:\\Profiles\\A & B"' },
    { line: 'ChatGPT.exe --user-data-dir "C:\\Profiles\\Name With Spaces"', expected: '"--user-data-dir=C:\\Profiles\\Name With Spaces"' },
    { line: 'ChatGPT.exe "--user-data-dir=C:\\Profiles\\Name\\\\"', expected: '"--user-data-dir=C:\\Profiles\\Name\\\\"' },
    { line: 'ChatGPT.exe --user-data-dir=relative', rejected: true },
    { line: 'ChatGPT.exe --user-data-dir="C:\\Profiles\\bad\u001f"', rejected: true },
    { line: '', rejected: true },
  ];
  const encoded = Buffer.from(JSON.stringify(cases)).toString('base64');
  const source = path.join(__dirname, '../../src/platforms/windows/quit.cs').replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; Add-Type -Path '${source}';
    $cases=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json;
    foreach($case in $cases) {
      if($case.rejected) {
        $rejected=$false;
        try { [void][CodexFastQuit]::ActivationArguments($case.line) } catch { $rejected=$true }
        if(-not $rejected) { throw 'Unsafe profile was accepted.' }
      } elseif([CodexFastQuit]::ActivationArguments($case.line) -cne $case.expected) { throw 'Profile arguments changed.' }
    }`;
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-windows-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const source = path.join(root, 'Original app');
  const state = path.join(root, 'State with spaces');
  const unpacked = path.join(root, 'archive-source');
  fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(unpacked, 'webview/assets'), { recursive: true });
  fs.writeFileSync(path.join(unpacked, 'webview/assets/main.js'), snippets.join('\n'));
  fs.writeFileSync(path.join(unpacked, 'untouched.txt'), 'preserve this content');
  async function build(version = '1') {
    fs.writeFileSync(path.join(unpacked, 'package.json'), JSON.stringify({ name: 'openai-codex-electron',
      version, codexBuildNumber: version, codexBuildFlavor: 'prod', codexWindowsPackageIdentity: 'OpenAI.Codex',
      codexWindowsPackagePublisher: 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B' }));
    // ASAR returns its output stream before the final writes have finished.
    await finished(await asar.createPackage(unpacked, platform.archivePath(source)));
    const executable = NtExecutable.createEmpty(false, false);
    const resources = NtExecutableResource.from(executable);
    resources.replaceResourceEntryFromString('INTEGRITY', 'ELECTRONASAR', 1033,
      JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: integrity.headerHash(source) }]));
    resources.replaceResourceEntryFromString('UNRELATED', 'TEST', 1033, 'preserve this resource');
    resources.outputResource(executable);
    fs.writeFileSync(path.join(source, 'ChatGPT.exe'), Buffer.from(executable.generate()));
  }
  await build();
  for (const file of ['chrome.dll', 'resources/codex.exe', 'resources/owl-app.ini']) {
    fs.writeFileSync(path.join(source, file), `synthetic fixture: ${file}`);
  }
  fs.writeFileSync(path.join(source, 'owl-shell-runtime.json'), JSON.stringify({ schemaVersion: 1,
    platform: 'win32', arch: 'x64', msixPackageDependencies: [] }));
  const options = { verify: platform.metadata, stopped: () => {}, plan: archive => planArchive(archive, recipes) };
  const install = extra => store.withLock(state, () => store.install(source, state, { ...options, ...extra }));
  return { root, source, state, unpacked, build, options, install };
}

test('Windows install publishes a verified copy, preserves the source, and restores the original launch target', async t => {
  const f = await fixture(t);
  const original = platform.fingerprint(f.source);
  const result = await f.install();
  assert.equal(result.status, 'installed');
  assert.equal(result.checks, 12);
  assert.equal(platform.same(f.source, original), true);
  assert.notEqual(result.app, f.source);
  integrity.verify(result.app);
  assert.notDeepEqual(fs.readFileSync(path.join(result.app, 'ChatGPT.exe')), fs.readFileSync(path.join(f.source, 'ChatGPT.exe')));
  assert.equal(asar.extractFile(platform.archivePath(result.app), 'untouched.txt').toString(), 'preserve this content');
  assert.equal((await f.install()).status, 'already-installed');
  assert.equal(store.restore(f.state, f.options).status, 'restored');
  assert.equal(store.checkedActive(f.state), null);
  assert.equal(platform.same(f.source, original), true);
  assert.equal(fs.existsSync(result.app), true);
  assert.equal(store.restore(f.state, f.options).status, 'already-original');
});

test('Windows archive hashes must match the executable resource and duplicate resources fail closed', async t => {
  const f = await fixture(t);
  integrity.verify(f.source);
  const executableFile = path.join(f.source, 'ChatGPT.exe');
  const parsed = integrity.read(fs.readFileSync(executableFile));
  parsed.resources.replaceResourceEntryFromString('INTEGRITY', 'ELECTRONASAR', 1033,
    JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: '0'.repeat(64) }]));
  parsed.resources.outputResource(parsed.executable);
  fs.writeFileSync(executableFile, Buffer.from(parsed.executable.generate()));
  assert.throws(() => integrity.verify(f.source), /does not match/);
  await assert.rejects(f.install(), /original Windows archive hash changed/);
  assert.equal(store.checkedActive(f.state), null);
  parsed.resources.replaceResourceEntryFromString('INTEGRITY', 'ELECTRONASAR', 0, '[]');
  parsed.resources.outputResource(parsed.executable);
  assert.throws(() => integrity.read(Buffer.from(parsed.executable.generate())), /uniquely identify/);
});

test('Windows CLI preserves the failure phase and message for diagnosis', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const original = platform.fingerprint(f.source);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../cli.cjs'), 'install', '--app', f.source, '--state', f.state],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const recorded = store.readOptional(store.statusPath(f.state));
  assert.equal(recorded.status, 'failed');
  assert.equal(recorded.phase, 'verifying-source');
  assert.ok(recorded.message);
  assert.ok(recorded.checkedAt);
  assert.equal(store.checkedActive(f.state), null);
  assert.equal(platform.same(f.source, original), true);
  assert.throws(() => platform.native('signature', { files: [path.join(f.root, 'missing.exe')] }),
    error => error.code === 'WINDOWS_NATIVE_FAILED' && !error.message.includes('-Payload'));
});

test('a new official version gets a new generation without modifying the previous copy', async t => {
  const f = await fixture(t);
  const first = await f.install();
  const old = platform.fingerprint(first.app);
  await f.build('2');
  const second = await f.install();
  assert.notEqual(first.app, second.app);
  assert.equal(store.checkedActive(f.state).version, '2');
  assert.equal(platform.same(first.app, old), true);
  assert.equal(platform.metadata(f.source).version, '2');
});

test('recognition and copy failures leave the existing launch pointer unchanged', async t => {
  const f = await fixture(t);
  await f.install();
  const before = fs.readFileSync(store.activePath(f.state));
  await f.build('2');
  await assert.rejects(f.install({ plan: async () => { throw new Error('unsupported build'); } }), /unsupported build/);
  assert.deepEqual(fs.readFileSync(store.activePath(f.state)), before);
  await assert.rejects(f.install({ copy: () => { throw new Error('disk full'); } }), /disk full/);
  assert.deepEqual(fs.readFileSync(store.activePath(f.state)), before);
});

test('a source update or manual reopen during staging prevents publication', async t => {
  const f = await fixture(t);
  await f.install();
  const before = fs.readFileSync(store.activePath(f.state));
  await f.build('2');
  await assert.rejects(f.install({ onPhase: phase => {
    if (phase === 'patching') fs.appendFileSync(path.join(f.source, 'resources/owl-app.ini'), '\nupdated');
  } }), /updated during preparation/);
  assert.deepEqual(fs.readFileSync(store.activePath(f.state)), before);
  let checks = 0;
  await assert.rejects(f.install({ stopped: () => {
    if (++checks > 1) throw Object.assign(new Error('reopened'), { code: 'APP_RUNNING' });
  } }), { code: 'APP_RUNNING' });
  assert.deepEqual(fs.readFileSync(store.activePath(f.state)), before);
});

test('process exit immediately before publication leaves the previous generation recoverable', async t => {
  const f = await fixture(t);
  await f.install();
  const before = fs.readFileSync(store.activePath(f.state));
  await f.build('2');
  const child = spawnSync(process.execPath, ['-e', `
    const store = require('./src/platforms/windows/store.cjs');
    const platform = require('./src/platforms/windows/platform.cjs');
    const { planArchive } = require('./src/core/adaptive.cjs');
    const { recipes } = require('./test/support/fixtures.cjs');
    store.withLock(process.argv[2], () => store.install(process.argv[1], process.argv[2], {
      verify: platform.metadata, stopped: () => {}, plan: archive => planArchive(archive, recipes),
      onPhase: phase => { if (phase === 'prepared') process.exit(73); }
    })).catch(() => process.exit(1));
  `, f.source, f.state], { cwd: path.join(__dirname, '../..'), encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 73, child.stderr);
  assert.deepEqual(fs.readFileSync(store.activePath(f.state)), before);
  assert.equal((await f.install()).status, 'installed');
  assert.equal(store.checkedActive(f.state).version, '2');
});

test('unsupported runtime layouts, nested state, and path traversal records are rejected', async t => {
  const f = await fixture(t);
  assert.equal(platform.normalizeApp(path.join(f.source, 'ChatGPT.exe')), f.source);
  assert.throws(() => store.assertSeparate(f.source, path.join(f.source, 'state')), /separate/);
  assert.throws(() => store.assertSeparate(f.source, f.root), /separate/);
  fs.mkdirSync(f.state);
  store.saveJson(store.activePath(f.state), { patchId: store.PATCH_ID, id: '../escape', app: f.source });
  assert.throws(() => store.checkedActive(f.state), /Invalid/);
  fs.unlinkSync(path.join(f.source, 'owl-shell-runtime.json'));
  assert.throws(() => platform.metadata(f.source), /Owl desktop runtime only/);
});

test('tampered local copies cannot be reused or launched', async t => {
  const f = await fixture(t);
  const result = await f.install();
  fs.appendFileSync(path.join(result.app, 'ChatGPT.exe'), 'changed');
  await assert.rejects(f.install(), /copy has changed/);
  await assert.rejects(launch(f.state, f.source, { processes: () => [], open: () => assert.fail('must not launch') }), /copy has changed/);
});

test('Windows monitoring waits for exit and retries rejected builds only when the source changes', async t => {
  const f = await fixture(t);
  await f.install();
  store.saveJson(store.configPath(f.state), { enabled: true, source: f.source });
  let generation = 1;
  let calls = 0;
  const options = { resolve: () => f.source, getStamp: () => generation, stopped: () => {},
    install: async () => { calls++; throw new Error('unrecognized build'); } };
  assert.equal((await automatic.tick(f.state, { ...options, stopped: () => {
    throw Object.assign(new Error('running'), { code: 'APP_RUNNING' });
  } })).status, 'waiting-for-exit');
  assert.equal(calls, 0);
  assert.equal((await automatic.tick(f.state, options)).status, 'failed');
  assert.equal((await automatic.tick(f.state, options)).status, 'rejected-until-next-update');
  assert.equal(calls, 1);
  generation++;
  const success = { ...options, install: async () => { calls++; return { status: 'already-installed' }; } };
  assert.equal((await automatic.tick(f.state, success)).status, 'installed');
  assert.equal((await automatic.tick(f.state, success)).status, 'idle');
  assert.equal(calls, 2);
});

test('Windows restart cancellation never patches or force terminates the app', async t => {
  const f = await fixture(t);
  let time = 0;
  let quits = 0;
  await assert.rejects(launch(f.state, f.source, { restart: true, timeoutMs: 500,
    processes: () => [{ path: platform.binaryPath(f.source) }], quit: () => { quits++; },
    now: () => time, wait: async ms => { time += ms; },
    install: () => assert.fail('must not install'), open: () => assert.fail('must not launch') }), { code: 'QUIT_TIMEOUT' });
  assert.equal(quits, 1);
  assert.equal(store.checkedActive(f.state), null);
});

test('Windows restart reopens the previous target after a failed installation', async t => {
  const f = await fixture(t);
  let running = true;
  const opened = [];
  await assert.rejects(launch(f.state, f.source, { restart: true,
    processes: () => running ? [{ path: platform.binaryPath(f.source) }] : [],
    quit: () => { running = false; }, open: app => opened.push(app),
    install: async () => { throw new Error('unsupported update'); } }), /unsupported update/);
  assert.deepEqual(opened, [f.source]);
});
