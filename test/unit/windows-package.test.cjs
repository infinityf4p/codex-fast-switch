const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('Windows packages expose exact portable ZIP paths and embedded build metadata', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const source = path.join(root, 'test-package'), zip = path.join(root, 'package.zip');
  fs.mkdirSync(path.join(source, 'launchers/windows'), { recursive: true });
  fs.writeFileSync(path.join(source, 'launchers/windows/Apply and Restart.cmd'), '@echo fixture');
  const build = { schemaVersion: 1, version: '0.2.5', commit: 'a'.repeat(40) };
  fs.writeFileSync(path.join(source, 'build-info.json'), JSON.stringify(build));
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const run = args => {
    const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', ...args],
      { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  run(['-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../../scripts/zip-windows.ps1'), '-Source', source, '-Destination', zip]);
  const inspect = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $archive=[IO.Compression.ZipFile]::OpenRead('${zip.replaceAll("'", "''")}');
    try {
      $entry=$archive.GetEntry('test-package/build-info.json');
      $reader=New-Object IO.StreamReader($entry.Open());
      try { $build=$reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
      [pscustomobject]@{names=@($archive.Entries | ForEach-Object {$_.FullName});build=$build} | ConvertTo-Json -Depth 4
    } finally { $archive.Dispose() }`;
  const contents = JSON.parse(run(['-EncodedCommand', Buffer.from(inspect, 'utf16le').toString('base64')]));
  assert.deepEqual(contents.names.sort(), ['test-package/build-info.json', 'test-package/launchers/windows/Apply and Restart.cmd']);
  assert.deepEqual(contents.build, build);
});
