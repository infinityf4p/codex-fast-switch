const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const shell = fs.readFileSync(path.join(__dirname, '../../uninstall.sh'), 'utf8');
const options = { skip: process.platform === 'win32' };

function fixture(t, { customState = false, installed = true, status = 'restored', fail = false, platform = 'Darwin' } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-uninstaller-test-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'test home');
  const state = customState ? path.join(directory, 'custom state & backup') :
    path.join(home, 'Library/Application Support/Codex Fast Switch');
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\nprintf '%s\\n' '${platform}'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(state, 'agent/runtime'), { recursive: true });
  if (installed) {
    fs.writeFileSync(path.join(state, 'agent/cli.cjs'), `module.exports.main = async args => {
  require('node:fs').writeFileSync(process.env.FAST_TEST_ARGS, JSON.stringify({ cli: __filename, args }));
  if (${fail}) throw new Error('Fixture restoration failed');
  return { status: ${JSON.stringify(status)} };
};\n`);
    fs.symlinkSync(process.execPath, path.join(state, 'agent/runtime/node'));
  }
  const argsFile = path.join(directory, 'args.txt');
  function run(args = [], { direct = false } = {}) {
    const script = path.join(directory, 'uninstall.sh');
    fs.writeFileSync(script, shell);
    return spawnSync('/bin/sh', direct ? [script, ...args] : ['-s', '--', ...args], {
      input: direct ? undefined : shell,
      encoding: 'utf8', cwd: directory,
      env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, FAST_TEST_ARGS: argsFile },
    });
  }
  return { run, state, argsFile, directory };
}

test('piped uninstaller uses the installed CLI and only requests restore', options, t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.argsFile, 'utf8')), {
    cli: path.join(f.state, 'agent/cli.cjs'), args: ['restore', '--state', f.state],
  });
  assert.match(result.stdout, /Fast patch removed/);
});

test('custom state selects its matching runtime and preserves app arguments', options, t => {
  const f = fixture(t, { customState: true, fail: true });
  const app = path.join(f.directory, 'Codex & Tools.app');
  const result = f.run(['--state', f.state, '--app', app]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Fixture restoration failed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.argsFile, 'utf8')), {
    cli: path.join(f.state, 'agent/cli.cjs'), args: ['restore', '--state', f.state, '--app', app],
  });
  assert.doesNotMatch(result.stdout, /Fast patch removed/);
});

test('direct script can use the adjacent package CLI without an installed worker', options, t => {
  const f = fixture(t);
  fs.renameSync(path.join(f.state, 'agent/cli.cjs'), path.join(f.directory, 'cli.cjs'));
  const result = f.run([], { direct: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(f.argsFile, 'utf8')).cli, path.join(f.directory, 'cli.cjs'));
});

test('busy or unexpected recovery results do not report successful uninstall', options, t => {
  for (const status of ['busy', 'installed']) {
    const f = fixture(t, { status });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Uninstall failed/);
    assert.doesNotMatch(result.stdout, /Fast patch removed/);
  }
});

test('help and invalid arguments never run the recovery program', options, t => {
  const f = fixture(t);
  assert.equal(f.run(['--help']).status, 0);
  for (const args of [['--state'], ['--app', ''], ['--state', '--app'], ['--unknown']]) {
    assert.equal(f.run(args).status, 2);
  }
  assert.equal(fs.existsSync(f.argsFile), false);
});

test('missing recovery program fails without downloading or installing a patch', options, t => {
  const f = fixture(t, { installed: false });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No installed recovery program/);
  assert.equal(fs.existsSync(f.argsFile), false);
});

test('non-macOS hosts are directed to the Windows uninstaller', options, t => {
  const f = fixture(t, { platform: 'Linux' });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /uninstall.cmd/);
  assert.equal(fs.existsSync(f.argsFile), false);
});
