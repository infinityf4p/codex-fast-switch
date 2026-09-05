const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const walk = require('acorn-walk');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const adaptive = require('../lib/adaptive.cjs');
const { patchArchive, sha256 } = require('../lib/archive.cjs');
const tx = require('../lib/transaction.cjs');
const automatic = require('../automatic.cjs');
const { probeEnvironment, probeConfig, chooseModel } = require('../lib/probe.cjs');
const { CdpPipe } = require('../lib/cdp.cjs');
const { snippets, recipes } = require('./fixtures.cjs');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('renamed identifiers, quotes, whitespace and unrelated functions remain recognizable', async () => {
  let source = snippets.join('\n');
  const edits = new Map();
  walk.fullAncestor(adaptive.parse(source), (node, _, ancestors) => {
    if (node.type !== 'Identifier') return;
    const parent = ancestors.at(-2);
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
    if (parent?.type === 'Property' && parent.key === node && !parent.computed) return;
    edits.set(node.start, { start: node.start, end: node.end, value: `renamed_${node.name}` });
  });
  for (const edit of [...edits.values()].sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  source = source.replaceAll('"chatgpt"', '`chatgpt`') + '\n/* bundler change */\nfunction unrelated(){return 42;}';
  const result = adaptive.adapt(source, recipes);
  assert.equal(result.matches.length, 3);
  assert.equal((await adaptive.validateGates(result.matches)).length, 12);
  assert.match(result.patched, /additionalAvailableModels/);
});

test('policy operators, property names and values remain part of the structural fingerprint', () => {
  for (const changed of [snippets[0].replace('!==false', '===false'), snippets[0].replace('fast_mode', 'fast_mode_v2'), snippets[0].replace('"chatgpt"', '"other"')]) {
    assert.equal(adaptive.adapt(changed, recipes).matches.length, 0);
  }
});

test('unexpected patched fingerprints are rejected', () => {
  assert.throws(() => adaptive.adapt(snippets.join('\n'), recipes.map(recipe => ({ ...recipe, patchedFingerprint: 'invalid' }))), /Unexpected transformed/);
});

test('split and renamed chunks are patched with integrity hashes and unrelated bytes preserved', async t => {
  const root = temporary(t);
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'webview/renamed'), { recursive: true });
  snippets.forEach((snippet, i) => fs.writeFileSync(path.join(source, `webview/renamed/chunk-${i}.js`), snippet));
  const unrelated = Buffer.from([0, 1, 2, 255, 8]);
  fs.writeFileSync(path.join(source, 'untouched.bin'), unrelated);
  const archive = path.join(root, 'app.asar');
  await asar.createPackage(source, archive);
  const plan = await adaptive.planArchive(archive, recipes);
  assert.equal(plan.targets.length, 3);
  assert.equal(plan.checks.length, 12);
  for (const target of plan.targets) patchArchive(archive, target.entry, () => target.patched);
  assert.deepEqual(asar.extractFile(archive, 'untouched.bin'), unrelated);
  for (const target of plan.targets) {
    assert.deepEqual(asar.extractFile(archive, target.entry), target.patched);
    assert.equal(asar.statFile(archive, target.entry).integrity.hash, sha256(target.patched));
  }
  await assert.rejects(adaptive.planArchive(archive, recipes), /uniquely recognize/);
  fs.copyFileSync(path.join(source, 'webview/renamed/chunk-0.js'), path.join(source, 'webview/duplicate.js'));
  await asar.createPackage(source, archive);
  await assert.rejects(adaptive.planArchive(archive, recipes), /uniquely recognize/);
});

test('missing or damaged archive entries cannot be patched', async t => {
  const root = temporary(t);
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'test.js'), 'known bytes');
  const archive = path.join(root, 'app.asar');
  await asar.createPackage(source, archive);
  assert.throws(() => patchArchive(archive, 'missing', bytes => bytes), /not a packed/);
  const data = fs.readFileSync(archive);
  data[data.length - 1] ^= 1;
  fs.writeFileSync(archive, data);
  assert.throws(() => patchArchive(archive, 'test.js', bytes => bytes), /integrity mismatch/);
});

test('live locks exclude a second installer and abandoned locks are recovered', async t => {
  const root = temporary(t);
  assert.equal((await tx.withLock(root, () => tx.withLock(root, () => assert.fail('concurrent mutation')))).status, 'busy');
  fs.mkdirSync(path.join(root, 'automatic.lock'));
  tx.saveJson(path.join(root, 'automatic.lock/owner.json'), { pid: 2147483647 });
  assert.equal(await tx.withLock(root, () => 'recovered'), 'recovered');
});

test('recovery rejects records pointing outside its transaction directory', t => {
  const root = temporary(t);
  tx.saveJson(tx.recordPath(root), { id: '../elsewhere' });
  assert.throws(() => tx.checkedRecord(root, root), /Invalid recovery record/);
});

test('disable and restore leave a live transaction alone', { skip: process.platform !== 'darwin' }, async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  await tx.withLock(root, async () => {
    assert.equal((await automatic.disable(root)).status, 'busy');
    assert.equal((await automatic.restore(root, root)).status, 'busy');
  });
  assert.equal(automatic.status(root).configuration.enabled, true);
});

test('monitor waits for stability and exit, reports failure once, then retries a new build', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root, model: 'example-model' });
  let generation = 1;
  let calls = 0;
  const notices = [];
  const options = { now: 100000, stopped: () => {}, getStamp: () => generation, notifyUser: value => notices.push(value),
    install: async (app, state, config) => { calls++; assert.equal(config.model, 'example-model'); throw new Error('unsupported build'); } };
  assert.equal((await automatic.tick(root, { ...options, stopped: () => { throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); } })).status, 'waiting-for-exit');
  assert.equal((await automatic.tick(root, { ...options, stopped: () => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); } })).status, 'process-check-failed');
  assert.equal((await automatic.tick(root, options)).status, 'waiting-for-stable-update');
  assert.equal((await automatic.tick(root, { ...options, now: 110000 })).status, 'waiting-for-stable-update');
  assert.equal(calls, 0);
  assert.equal((await automatic.tick(root, { ...options, now: 140000 })).status, 'failed');
  assert.equal((await automatic.tick(root, { ...options, now: 200000 })).status, 'rejected-until-next-update');
  assert.equal(calls, 1);
  assert.equal(notices.length, 1);
  generation++;
  const next = { ...options, now: 250000, install: async () => { calls++; return { status: 'installed' }; } };
  assert.equal((await automatic.tick(root, next)).status, 'waiting-for-stable-update');
  assert.equal((await automatic.tick(root, { ...next, now: 290000 })).status, 'installed');
  assert.equal((await automatic.tick(root, { ...next, now: 350000 })).status, 'idle');
  assert.equal(calls, 2);
});

test('an update disappearing during failed installation still yields a recorded failure', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  let gone = false;
  const options = { now: 0, stopped: () => {}, notifyUser: () => {}, getStamp: () => { if (gone) throw new Error('updating'); return 1; },
    install: async () => { gone = true; throw new Error('update in progress'); } };
  await automatic.tick(root, options);
  assert.equal((await automatic.tick(root, { ...options, now: 40000 })).status, 'failed');
});

test('LaunchAgent uses an independent runtime and has no keepalive restart loop', () => {
  const plist = automatic.plistDefinition('/stable/node', '/stable/automatic.cjs', '/state');
  assert.deepEqual(plist.ProgramArguments, ['/stable/node', '/stable/automatic.cjs', 'tick', '/state']);
  assert.equal(plist.StartInterval, 60);
  assert.equal(plist.RunAtLoad, true);
  assert.equal(plist.KeepAlive, undefined);
});

test('probe environment strips credentials, provider overrides, proxies and Node injection', () => {
  const env = probeEnvironment('/temporary', { HOME: '/real', CODEX_HOME: '/real/codex', OPENAI_API_KEY: 'sensitive',
    OPENAI_BASE_URL: 'https://external.invalid', HTTPS_PROXY: 'https://external.invalid', NODE_OPTIONS: '--require unwanted', AWS_ACCESS_KEY_ID: 'sensitive' });
  for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HTTPS_PROXY', 'NODE_OPTIONS', 'AWS_ACCESS_KEY_ID']) assert.equal(env[name], undefined);
  assert.equal(env.HOME, '/temporary');
  assert.equal(env.CODEX_HOME, '/temporary/codex');
  assert.match(probeConfig(4567, 'example-model'), /http:\/\/127\.0\.0\.1:4567/);
  assert.match(probeConfig(4567), /cli_auth_credentials_store = "file"/);
  assert.throws(() => probeConfig(4567, 'bad"\nbase_url="external'), /Invalid verification model/);
});

test('probe model selection requires backend priority metadata', () => {
  const models = [{ model: 'plain' }, { model: 'fast', serviceTiers: [{ id: 'priority' }] },
    { model: 'default-fast', isDefault: true, serviceTiers: [{ id: 'priority' }] }];
  assert.equal(chooseModel(models), 'default-fast');
  assert.equal(chooseModel(models, 'fast'), 'fast');
  assert.throws(() => chooseModel(models, 'plain'), /compatible priority model/);
  assert.throws(() => chooseModel([]), /compatible priority model/);
});

test('CDP responses support split frames and pending operations reject on exit', async () => {
  const child = new EventEmitter();
  child.stdio = [null, null, null, new PassThrough(), new PassThrough()];
  const cdp = new CdpPipe(child);
  const first = cdp.call('example');
  child.stdio[4].write('{"id":1,"res');
  child.stdio[4].write('ult":{"ok":true}}\0');
  assert.deepEqual(await first, { ok: true });
  const second = cdp.call('next');
  child.emit('exit', 1);
  await assert.rejects(second, /exited/);
});
