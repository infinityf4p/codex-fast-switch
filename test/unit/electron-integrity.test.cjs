const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SENTINEL,
  readSlot,
  disableSlot,
  inspectApp,
} = require('../../src/platforms/macos/electron-integrity.cjs');

function fixture(t, used = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'framework');
  const data = Buffer.alloc(128, 0x5a);
  const offset = 19;
  SENTINEL.copy(data, offset);
  data[offset + SENTINEL.length] = used;
  data[offset + SENTINEL.length + 1] = 1;
  fs.writeFileSync(binary, data);
  return { binary, usedOffset: offset + SENTINEL.length };
}

test('disabling an Electron integrity slot is byte-local and idempotent', t => {
  const { binary, usedOffset } = fixture(t);
  assert.equal(readSlot(binary).used, 1);
  const changed = disableSlot(binary);
  assert.equal(changed.changed, true);
  assert.equal(changed.previousUsed, 1);
  assert.equal(readSlot(binary).used, 0);
  assert.equal(fs.readFileSync(binary)[usedOffset], 0);
  assert.equal(disableSlot(binary).changed, false);
});

test('malformed or ambiguous integrity slots fail closed', t => {
  const { binary } = fixture(t, 2);
  assert.throws(() => readSlot(binary), /unsupported used value/);

  const duplicate = fixture(t).binary;
  const data = fs.readFileSync(duplicate);
  SENTINEL.copy(data, 80);
  fs.writeFileSync(duplicate, data);
  assert.throws(() => readSlot(duplicate), /ambiguous/);
});

test('apps without the Electron slot remain supported', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-integrity-app-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(inspectApp(root), { supported: false, changed: false });
});
