const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { buildSite } = require('../../scripts/latest-site.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-downloads-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'), output = path.join(root, 'site');
  fs.mkdirSync(input);
  const version = '0.2.5', commit = 'a'.repeat(40);
  for (const suffix of ['windows', 'macos-universal']) fs.writeFileSync(path.join(input, `codex-fast-switch-${version}-${suffix}.zip`), `synthetic ${suffix} archive`);
  return { input, output, commit, options: { version, readBuild: () => ({ schemaVersion: 1, version, commit }) } };
}

test('latest downloads bind both platform packages to one source commit and their checksums', t => {
  const f = fixture(t);
  const manifest = buildSite(f.input, f.output, f.commit, f.options);
  for (const asset of Object.values(manifest.assets)) {
    const bytes = fs.readFileSync(path.join(f.output, f.commit, asset.directory + '.zip'));
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.ok(asset.url.includes('/' + f.commit + '/'));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output, 'latest.json'), 'utf8')), manifest);
  for (const file of ['install.cmd', 'uninstall.cmd', 'install.sh', 'uninstall.sh', 'index.html']) assert.equal(fs.existsSync(path.join(f.output, file)), true);
});

test('a missing platform or a mismatched build never produces a publishable manifest', t => {
  for (const mode of ['missing', 'mismatch']) {
    const f = fixture(t);
    if (mode === 'missing') fs.unlinkSync(path.join(f.input, 'codex-fast-switch-0.2.5-macos-universal.zip'));
    else f.options.readBuild = () => ({ schemaVersion: 1, version: '0.2.5', commit: 'b'.repeat(40) });
    assert.throws(() => buildSite(f.input, f.output, f.commit, f.options));
    assert.equal(fs.existsSync(path.join(f.output, 'latest.json')), false);
  }
});

test('site generation refuses ambiguous existing output or an invalid commit', t => {
  const f = fixture(t);
  assert.throws(() => buildSite(f.input, f.output, '../other', f.options), /Invalid/);
  fs.mkdirSync(f.output);
  fs.writeFileSync(path.join(f.output, 'sentinel'), 'keep');
  assert.throws(() => buildSite(f.input, f.output, f.commit, f.options), /must be empty/);
  assert.equal(fs.readFileSync(path.join(f.output, 'sentinel'), 'utf8'), 'keep');
});
