const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const shell = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
const source = shell.split("<<'NODE'\n")[1].split('\nNODE\n')[0];

function runInstaller(t, { corrupt = false, unexpectedUrl = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-installer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('independent synthetic release');
  const name = 'codex-fast-switch-0.2.2-macos-universal.zip';
  const release = { tag_name: 'v0.2.2', draft: false, prerelease: false, assets: [{ name,
    digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    browser_download_url: unexpectedUrl ? 'https://example.invalid/package.zip' :
      `https://github.com/infinityf4p/codex-fast-switch/releases/download/v0.2.2/${name}` }] };
  const calls = [];
  const errors = [];
  const processStub = { argv: ['node', '-', directory, '--app', '/selected/Codex.app'], execPath: '/runtime/node', exitCode: 0 };
  vm.runInNewContext(source, {
    process: processStub, URL,
    console: { log() {}, error: message => errors.push(message) },
    require: name => name === 'node:child_process' ? { execFileSync(command, args) {
      calls.push({ command, args: [...args] });
      if (command !== '/usr/bin/curl') return;
      const destination = args[args.indexOf('--output') + 1];
      fs.writeFileSync(destination, args.at(-1).endsWith('/releases/latest') ? JSON.stringify(release) :
        corrupt ? Buffer.from('corrupted package') : bytes);
    } } : require(name),
  });
  return { calls, errors, exitCode: processStub.exitCode };
}

test('verified release runs combined setup with the selected app', t => {
  const result = runInstaller(t);
  assert.equal(result.exitCode, 0);
  const commands = result.calls.map(call => call.command);
  assert.deepEqual(commands, ['/usr/bin/curl', '/usr/bin/curl', '/usr/bin/ditto', '/runtime/node']);
  assert.deepEqual(result.calls.at(-1).args.slice(1), ['setup', '--app', '/selected/Codex.app']);
});

test('damaged downloads are rejected before extraction or execution', t => {
  const result = runInstaller(t, { corrupt: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors[0], /SHA-256 check/);
  assert.equal(result.calls.every(call => call.command === '/usr/bin/curl'), true);
});

test('unexpected release URLs are rejected before download', t => {
  const result = runInstaller(t, { unexpectedUrl: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors[0], /unexpected download URL/);
  assert.equal(result.calls.length, 1);
});
