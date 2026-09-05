const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const helper = path.join(__dirname, '../../build/macos/native-helper');

test('native helper exchanges complete directories and refuses a missing counterpart', { skip: process.platform !== 'darwin' }, t => {
  assert.ok(fs.existsSync(helper), 'Run npm run build before macOS tests.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const left = path.join(root, 'left');
  const right = path.join(root, 'right');
  fs.mkdirSync(left);
  fs.mkdirSync(right);
  fs.writeFileSync(path.join(left, 'value'), 'original');
  fs.writeFileSync(path.join(right, 'value'), 'patched');
  execFileSync(helper, ['swap', left, right]);
  assert.equal(fs.readFileSync(path.join(left, 'value'), 'utf8'), 'patched');
  assert.equal(fs.readFileSync(path.join(right, 'value'), 'utf8'), 'original');
  const failed = spawnSync(helper, ['swap', left, path.join(root, 'absent')]);
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(path.join(left, 'value'), 'utf8'), 'patched');
  execFileSync(helper, ['swap', left, right]);
  assert.equal(fs.readFileSync(path.join(left, 'value'), 'utf8'), 'original');
});
