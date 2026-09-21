const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { windowsBootstrap } = require('../../scripts/bootstrap.cjs');
const windows = { skip: process.platform !== 'win32' };

function fixture(t, { mode = 'ok', command = 'setup' } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-bootstrap-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const name = 'codex-fast-switch-0.2.5-windows', commit = (mode === 'rollover' ? 'b' : 'a').repeat(40);
  const packageRoot = path.join(root, name), temporary = path.join(root, 'temp'), local = path.join(root, 'local');
  const trace = path.join(root, 'requests.txt'), executed = path.join(root, 'executed.txt');
  const runner = path.join(packageRoot, 'launchers/windows/run.ps1');
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.mkdirSync(temporary); fs.mkdirSync(local);
  const quote = text => `'${text.replaceAll("'", "''")}'`;
  fs.writeFileSync(runner, `param([string]$Command)\n[IO.File]::WriteAllText(${quote(executed)}, $Command)\nexit 0\n`);
  fs.writeFileSync(path.join(packageRoot, 'build-info.json'), JSON.stringify({ commit: mode === 'wrong-build' ? 'c'.repeat(40) : commit }));
  const archive = path.join(root, 'package.zip');
  let zipCommand = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem;
    [IO.Compression.ZipFile]::CreateFromDirectory(${quote(packageRoot)},${quote(archive)},[IO.Compression.CompressionLevel]::Optimal,$true);`;
  if (mode === 'traversal') zipCommand += `Add-Type -AssemblyName System.IO.Compression;
    $archive=[IO.Compression.ZipFile]::Open(${quote(archive)},[IO.Compression.ZipArchiveMode]::Update);
    try {[void]$archive.CreateEntry('../outside.txt')}finally{$archive.Dispose()}`;
  const packed = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(zipCommand, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(packed.error);
  assert.equal(packed.status, 0, packed.stderr);
  const bytes = fs.readFileSync(archive);
  const metadata = { schemaVersion: 1, version: '0.2.5', commit, assets: { win32: { directory: name,
    url: mode === 'url' ? 'https://example.invalid/package.zip' : `https://infinityf4p.github.io/codex-fast-switch/${commit}/${name}.zip`,
    size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } } };
  const spec = path.join(root, 'case.json');
  fs.writeFileSync(spec, JSON.stringify({ mode, command, temporary, local, trace, executed, archive, metadata }));
  return { root, temporary, executed, trace, run() {
    const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, '../support/windows-bootstrap.ps1'), '-Implementation',
      path.join(__dirname, '../../scripts/windows-bootstrap.ps1'), '-Spec', spec],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.ifError(result.error);
    assert.deepEqual(fs.readdirSync(temporary), [], result.stdout + result.stderr);
    return result;
  } };
}

test('Windows online installer and uninstaller verify the latest package and forward only their action', windows, t => {
  for (const command of ['setup', 'uninstall']) {
    const f = fixture(t, { command }), result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(f.executed, 'utf8'), command);
    assert.equal(fs.readFileSync(f.trace, 'utf8').trim().split(/\r?\n/).length, 2);
  }
});

test('Windows online bootstrap rejects wrong URLs, checksums, paths and embedded commits before execution', windows, t => {
  for (const mode of ['url', 'corrupt', 'traversal', 'wrong-build']) {
    const f = fixture(t, { mode }), result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(fs.existsSync(f.executed), false);
    assert.match(result.stdout, /unexpected download URL|SHA-256|unexpected path|different build/);
    assert.equal(fs.existsSync(path.join(f.temporary, 'outside.txt')), false);
  }
});

test('Windows bootstrap retries a concurrent deployment using new metadata', windows, t => {
  const f = fixture(t, { mode: 'rollover' }), result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(f.executed, 'utf8'), 'setup');
  assert.equal(fs.readFileSync(f.trace, 'utf8').trim().split(/\r?\n/).length, 4);
});

test('a standalone downloaded install script displays help without fetching a package', windows, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-bootstrap-help-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const script = path.join(root, 'install.cmd');
  fs.writeFileSync(script, windowsBootstrap('setup'));
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${script}" --help"`],
    { input: '\n', encoding: 'utf8', timeout: 30000, windowsHide: true, windowsVerbatimArguments: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Every run checks/);
  assert.doesNotMatch(result.stdout, /Latest build:/);
});
