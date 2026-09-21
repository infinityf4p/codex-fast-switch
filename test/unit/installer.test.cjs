const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const shell = fs.readFileSync(path.join(__dirname, '../../install.sh'), 'utf8').replace(/\r\n/g, '\n');
const source = shell.split("<<'NODE'\n")[1].split('\nNODE\n')[0];

function runInstaller(t, { corrupt = false, unexpectedUrl = false, unsafeEntry = false, rollover = false, wrongBuild = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-installer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('independent synthetic main build');
  const packageDirectory = 'codex-fast-switch-0.2.5-macos-universal';
  let metadataCount = 0, archiveCount = 0, current;
  function metadata() {
    const commit = (rollover && metadataCount++ ? 'b' : 'a').repeat(40);
    return current = { schemaVersion: 1, commit, version: '0.2.5', assets: { darwin: { directory: packageDirectory,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
      url: unexpectedUrl ? 'https://example.invalid/package.zip' :
        `https://infinityf4p.github.io/codex-fast-switch/${commit}/${packageDirectory}.zip` } } };
  }
  const calls = [];
  const errors = [];
  const processStub = { argv: ['node', '-', directory, '--app', '/selected/Codex.app'], execPath: '/runtime/node', exitCode: 0 };
  vm.runInNewContext(source, {
    process: processStub, URL,
    console: { log() {}, error: message => errors.push(message) },
    require: name => name === 'node:child_process' ? { execFileSync(command, args) {
      calls.push({ command, args: [...args] });
      if (command === '/usr/bin/unzip') return `${packageDirectory}/\n${packageDirectory}/${unsafeEntry ? '../outside' : 'build-info.json'}\n`;
      if (command === '/usr/bin/ditto') {
        const root = path.join(directory, 'unpacked', packageDirectory);
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify({ commit: wrongBuild ? 'c'.repeat(40) : current.commit }));
      }
      if (command !== '/usr/bin/curl') return;
      const destination = args[args.indexOf('--output') + 1];
      if (args.at(-1).includes('/latest.json?')) fs.writeFileSync(destination, JSON.stringify(metadata()));
      else {
        if (rollover && archiveCount++ === 0) throw new Error('404: deployment changed');
        fs.writeFileSync(destination, corrupt ? Buffer.from('corrupted package') : bytes);
      }
    } } : require(name),
  });
  return { calls, errors, exitCode: processStub.exitCode };
}

test('verified latest main build runs combined setup with the selected app', t => {
  const result = runInstaller(t);
  assert.equal(result.exitCode, 0);
  const commands = result.calls.map(call => call.command);
  assert.deepEqual(commands, ['/usr/bin/curl', '/usr/bin/curl', '/usr/bin/unzip', '/usr/bin/ditto', '/runtime/node']);
  assert.deepEqual(result.calls.at(-1).args.slice(1), ['setup', '--app', '/selected/Codex.app']);
});

test('damaged downloads are rejected before extraction or execution', t => {
  const result = runInstaller(t, { corrupt: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors[0], /SHA-256 check/);
  assert.equal(result.calls.every(call => call.command === '/usr/bin/curl'), true);
});

test('unexpected update URLs are rejected before package download', t => {
  const result = runInstaller(t, { unexpectedUrl: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors[0], /unexpected download URL/);
  assert.equal(result.calls.length, 2);
});

test('a deployment rollover rereads metadata and executes only the matching newer package', t => {
  const result = runInstaller(t, { rollover: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.filter(call => call.command === '/usr/bin/curl').length, 4);
  assert.ok(result.calls.some(call => call.args.at(-1)?.includes('/' + 'b'.repeat(40) + '/')));
  assert.equal(result.calls.filter(call => call.command === '/runtime/node').length, 1);
});

test('archive traversal and mismatched embedded build identities are rejected before execution', t => {
  for (const options of [{ unsafeEntry: true }, { wrongBuild: true }]) {
    const result = runInstaller(t, options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.some(call => call.command === '/runtime/node'), false);
    assert.match(result.errors[0], /unexpected path|different build/);
  }
});
