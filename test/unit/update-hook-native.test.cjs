const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('native handoff changes only the relaunch bit after worker readiness, with failure fallback', { skip: process.platform !== 'darwin' }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-update-native-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'Probe.app');
  const binary = path.join(app, 'Contents/MacOS/probe');
  const framework = path.join(root, 'Sparkle.framework');
  const state = path.join(root, 'state');
  const worker = path.join(state, 'agent/src/platforms/macos/relaunch.cjs');
  for (const dir of [path.dirname(binary), path.join(framework, 'Resources'), path.dirname(worker), path.join(state, 'agent/runtime')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const plist = (file, values) => {
    fs.writeFileSync(file, JSON.stringify(values));
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', file]);
  };
  plist(path.join(app, 'Contents/Info.plist'), { CFBundleExecutable: 'probe', CFBundleIdentifier: 'test.codex-fast.probe', CFBundlePackageType: 'APPL' });
  plist(path.join(framework, 'Resources/Info.plist'), { CFBundleExecutable: 'Sparkle', CFBundleIdentifier: 'test.codex-fast.sparkle', CFBundlePackageType: 'FMWK', CFBundleShortVersionString: '2.9.1' });
  for (const [source, output, extra] of [['update-connection.m', path.join(framework, 'Sparkle'), ['-dynamiclib']], ['update-hook-probe.m', binary, []]]) {
    execFileSync('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-framework', 'Foundation', ...extra, path.join(__dirname, '../support', source), '-o', output]);
  }
  const hook = path.join(__dirname, '../../build/macos/codex-fast-update-hook.dylib');
  const run = () => execFileSync(binary, [path.join(framework, 'Sparkle'), hook, state, 'messages'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  const enable = enabled => fs.writeFileSync(path.join(state, 'automatic.json'), JSON.stringify({ enabled, app }));
  enable(true);
  assert.deepEqual(run(), [{ active: true }, { identifier: 0, bytes: [1, 1] }, { identifier: 2, bytes: [1] },
    { identifier: 2, bytes: [1, 1] }, { identifier: 2, bytes: [0, 1] }]);
  fs.symlinkSync(process.execPath, path.join(state, 'agent/runtime/node'));
  fs.writeFileSync(worker, 'process.stdout.write("ready");const pid=Number(process.argv[4]);const timer=setInterval(()=>{try{process.kill(pid,0)}catch{console.error("worker-survived-parent");clearInterval(timer)}},10);');
  const start = performance.now();
  assert.deepEqual(run(), [{ active: true }, { identifier: 0, bytes: [1, 1] }, { identifier: 2, bytes: [1] },
    { identifier: 2, bytes: [0, 1] }, { identifier: 2, bytes: [0, 1] }]);
  assert.ok(performance.now() - start < 2000);
  enable(false);
  assert.deepEqual(run()[3], { identifier: 2, bytes: [1, 1] });
  enable(true);
  fs.writeFileSync(worker, 'process.exit(1);');
  assert.deepEqual(run()[3], { identifier: 2, bytes: [1, 1] });
  plist(path.join(framework, 'Resources/Info.plist'), { CFBundleExecutable: 'Sparkle', CFBundleIdentifier: 'test.codex-fast.sparkle', CFBundlePackageType: 'FMWK', CFBundleShortVersionString: '3.0' });
  assert.equal(run()[0].active, false);
  // Let the dummy acknowledgement worker observe its parent's exit before removing its fixture.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.match(fs.readFileSync(path.join(state, 'update-relaunch.log'), 'utf8'), /worker-survived-parent/);
});
