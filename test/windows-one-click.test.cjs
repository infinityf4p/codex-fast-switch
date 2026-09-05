const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { oneClickScript } = require('../scripts/one-click.cjs');

test('standalone Windows script extracts, delegates, checks integrity and cleans up', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-one-click-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const packageName = 'codex-fast-switch-test-windows';
  const source = path.join(root, packageName);
  const bin = path.join(source, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'run.ps1'), [
    'param([string]$Command, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Options)',
    'Write-Output (\'COMMAND=\' + $Command)',
    'Write-Output (\'OPTIONS=\' + ($Options -join \',\'))',
    'exit ([int]$env:CODEX_FAST_TEST_EXIT)',
  ].join('\n'));
  const zip = path.join(root, 'package.zip');
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  function ps(command) {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem; ${command}`, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  ps(`[IO.Compression.ZipFile]::CreateFromDirectory(${quote(source)}, ${quote(zip)}, [IO.Compression.CompressionLevel]::Optimal, $true)`);
  const directory = path.join(root, '\u4e2d\u6587 & scripts');
  const temporary = path.join(root, 'temporary files');
  fs.mkdirSync(directory);
  fs.mkdirSync(temporary);
  const installer = path.join(directory, 'One Click.cmd');
  const archive = fs.readFileSync(zip);
  const script = oneClickScript(archive, packageName);
  fs.writeFileSync(installer, script);
  function run(argument = '', exitCode = '0') {
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${installer}" ${argument}"`],
      { input: '\n', encoding: 'utf8', timeout: 30000, windowsHide: true, windowsVerbatimArguments: true,
        env: { ...process.env, TEMP: temporary, TMP: temporary, CODEX_FAST_TEST_EXIT: exitCode } });
    assert.ifError(result.error);
    assert.deepEqual(fs.readdirSync(temporary), [], `${result.stdout}\n${result.stderr}`);
    return result;
  }
  const applied = run();
  assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
  assert.match(applied.stdout, /COMMAND=setup/);
  assert.doesNotMatch(applied.stdout, /OPTIONS=--help/);
  const help = run('--help');
  assert.equal(help.status, 0, `${help.stdout}\n${help.stderr}`);
  assert.match(help.stdout, /OPTIONS=--help/);
  assert.equal(run('', '7').status, 7);
  assert.equal(run('--invalid').status, 2);

  const hash = createHash('sha256').update(archive).digest('hex');
  fs.writeFileSync(installer, script.replace(hash, '0'.repeat(64)));
  const damaged = run();
  assert.equal(damaged.status, 1);
  assert.match(damaged.stdout, /embedded package is damaged/);
  assert.doesNotMatch(damaged.stdout, /COMMAND=/);

  ps(`$zip=[IO.Compression.ZipFile]::Open(${quote(zip)}, [IO.Compression.ZipArchiveMode]::Update); try { [void]$zip.CreateEntry('../outside.txt') } finally { $zip.Dispose() }`);
  fs.writeFileSync(installer, oneClickScript(fs.readFileSync(zip), packageName));
  const traversal = run();
  assert.equal(traversal.status, 1);
  assert.match(traversal.stdout, /unexpected path/);
  assert.doesNotMatch(traversal.stdout, /COMMAND=/);
  assert.equal(fs.existsSync(path.join(temporary, 'outside.txt')), false);
});
