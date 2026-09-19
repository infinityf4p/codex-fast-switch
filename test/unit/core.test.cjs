const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const asar = require('@electron/asar');
const walk = require('acorn-walk');
const { PassThrough } = require('node:stream');
const { finished } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const adaptive = require('../../src/core/adaptive.cjs');
const { patchArchive, sha256 } = require('../../src/core/archive.cjs');
const tx = require('../../src/platforms/macos/transaction.cjs');
const automatic = require('../../src/platforms/macos/automatic.cjs');
const { probeEnvironment, probeConfig, chooseModel } = require('../support/probe.cjs');
const { CdpPipe } = require('../support/cdp-pipe.cjs');
const { snippets, recipes } = require('../support/fixtures.cjs');

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

test('model recipe variants use the selected model from nested model settings', () => {
  const source = 'function models(host,selection){const {modelSettings:settings}=selection;const serviceTierForRequest=null;return getModels(host);}';
  const expected = source.replace('getModels(host)', 'getModels({...host,additionalAvailableModels:new Set([settings.model])})');
  const fn = adaptive.parse(source).body[0];
  const variant = { kind: 'models', fingerprint: adaptive.shape(fn).fingerprint,
    patchedFingerprint: adaptive.shape(adaptive.parse(expected).body[0]).fingerprint,
    path: ['body', 'body', 2, 'argument', 'arguments', 0],
    modelSettingsPath: ['body', 'body', 0, 'declarations', 0, 'id', 'properties', 0, 'value'], environment: [] };
  const alternatives = [...recipes, variant];
  const result = adaptive.adapt(source, alternatives);
  assert.equal(result.matches.length, 1);
  const context = vm.createContext({ getModels: options => options });
  vm.runInContext(result.patched, context);
  for (const model of ['first-model', 'another-model']) {
    context.selection = { model: 'wrong-level', modelSettings: { model } };
    const options = vm.runInContext('models({hostId:"local",conversationId:"existing"},selection)', context);
    assert.deepEqual([...options.additionalAvailableModels], [model]);
    assert.equal(options.hostId, 'local');
    assert.equal(options.conversationId, 'existing');
  }
  assert.equal(adaptive.adapt(snippets[2], alternatives).matches.length, 1);
  assert.equal(adaptive.adapt(source.replace('serviceTierForRequest=null', 'serviceTierForRequest="changed"'), alternatives).matches.length, 0);
});

test('saved default speed accepts API keys while retaining other authentication and policy restrictions', async () => {
  const source = 'function saved(client,adapters){return {async readServiceTier(){if(adapters.copilot)return false;const info=await client.account();const method=await client.method();return method!=="personalAccessToken"&&info.account?.type==="chatgpt"&&client.requirements.fast_mode!==false;}}}';
  const expected = source.replace('info.account?.type==="chatgpt"', '(info.account?.type==="chatgpt"||info.account?.type==="apiKey")');
  const fn = adaptive.parse(source).body[0];
  let target;
  walk.simple(fn, { BinaryExpression(node) { if (node.right.value === 'chatgpt') target = node; } });
  const recipe = { kind: 'saved-request', optional: true, fingerprint: adaptive.shape(fn).fingerprint,
    patchedFingerprint: adaptive.shape(adaptive.parse(expected).body[0]).fingerprint,
    path: adaptive.nodePath(fn, target), environment: [] };
  const result = adaptive.adapt(source, [recipe]);
  assert.equal(result.matches.length, 1);
  for (const account of ['apiKey', 'chatgpt', 'other', null]) for (const blocked of [false, true])
    for (const copilot of [false, true]) for (const token of [false, true]) {
      const context = vm.createContext({ client: { account: async () => ({ account: account == null ? null : { type: account } }),
        method: async () => token ? 'personalAccessToken' : 'apikey', requirements: { fast_mode: !blocked } }, adapters: { copilot } });
      const allowed = await vm.runInContext(`(${result.patched})(client,adapters).readServiceTier()`, context);
      assert.equal(allowed, ['apiKey', 'chatgpt'].includes(account) && !blocked && !copilot && !token);
    }
});

test('reviewed nested model settings preserve host options and older model queries', () => {
  const source = 'function models(host,current){const {modelSettings}=current;const serviceTierForRequest=modelSettings.serviceTier;return getModels(host);}';
  const fn = adaptive.parse(source).body[0];
  const target = fn.body.body[2].argument.arguments[0];
  const expected = source.replace('getModels(host)', 'getModels({...host,additionalAvailableModels:new Set([current.modelSettings.model])})');
  const variant = { fingerprint: adaptive.shape(fn).fingerprint,
    patchedFingerprint: adaptive.shape(adaptive.parse(expected).body[0]).fingerprint,
    path: adaptive.nodePath(fn, target), modelPath: ['modelSettings', 'model'] };
  const modelRecipe = { ...recipes[2], compatibleFingerprints: [variant] };
  for (const [input, settings] of [[source, { modelSettings: { model: 'selected-model', serviceTier: 'priority' } }],
    [snippets[2], { model: 'selected-model' }]]) {
    const result = adaptive.adapt(input, [modelRecipe]);
    assert.equal(result.matches.length, 1);
    const query = vm.runInNewContext(`(${result.patched})({hostId:'remote',enabled:true},settings)`, { settings, getModels: value => value });
    assert.equal(query.hostId, 'remote');
    assert.equal(query.enabled, true);
    assert.deepEqual([...query.additionalAvailableModels], ['selected-model']);
  }
  assert.equal(adaptive.adapt(source.replaceAll('modelSettings', 'modelPreferences'), [modelRecipe]).matches.length, 0);
  assert.throws(() => adaptive.adapt(source, [{ ...modelRecipe,
    compatibleFingerprints: [{ ...variant, modelPath: ['model'] }] }]), /Unexpected transformed/);
});

test('split and renamed chunks are patched with integrity hashes and unrelated bytes preserved', async t => {
  const root = temporary(t);
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'webview/renamed'), { recursive: true });
  snippets.forEach((snippet, i) => fs.writeFileSync(path.join(source, `webview/renamed/chunk-${i}.js`), snippet));
  const unrelated = Buffer.from([0, 1, 2, 255, 8]);
  fs.writeFileSync(path.join(source, 'untouched.bin'), unrelated);
  const archive = path.join(root, 'app.asar');
  await finished(await asar.createPackage(source, archive));
  const plan = await adaptive.planArchive(archive, recipes);
  // macOS/default planning still rejects missing appearance features. Windows
  // needs their identity to preserve other compatible transforms when retrying.
  for (const [feature, icon, compact, picker] of [
    ['fast-icon', require('../../src/core/icon-recipe.json'), null, null],
    ['compact-model-control', null, require('../../src/core/compact-recipe.json'), null],
    ['model-name', null, null, [require('../../src/core/picker-recipe.json')[0]]],
  ]) await assert.rejects(adaptive.planArchive(archive, recipes, icon, compact, picker),
    { code: 'UNSUPPORTED_APPEARANCE', appearance: feature });
  await assert.rejects(adaptive.planArchive(archive, recipes.map(recipe => recipe.kind === 'models'
    ? { ...recipe, requires: ['saved-request'] } : recipe)), /Cannot uniquely recognize saved-request/);
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
  await finished(await asar.createPackage(source, archive));
  await assert.rejects(adaptive.planArchive(archive, recipes), /uniquely recognize/);
});

test('missing or damaged archive entries cannot be patched', async t => {
  const root = temporary(t);
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'test.js'), 'known bytes');
  const archive = path.join(root, 'app.asar');
  await finished(await asar.createPackage(source, archive));
  assert.throws(() => patchArchive(archive, 'missing', bytes => bytes), /not a packed/);
  const data = fs.readFileSync(archive);
  data[data.length - 1] ^= 1;
  fs.writeFileSync(archive, data);
  assert.throws(() => patchArchive(archive, 'test.js', bytes => bytes), /integrity mismatch/);
});

test('shared request gates require exactly one recognized copy in each declared process scope', async t => {
  const root = temporary(t), source = path.join(root, 'source'), archive = path.join(root, 'app.asar');
  fs.mkdirSync(path.join(source, 'webview'), { recursive: true });
  fs.mkdirSync(path.join(source, '.vite/build'), { recursive: true });
  fs.writeFileSync(path.join(source, 'webview/app.js'), snippets.join('\n'));
  const scoped = recipes.map(recipe => recipe.kind === 'request' ? { ...recipe, scopes: ['webview', 'main'] } : recipe);
  const pack = async () => finished(await asar.createPackage(source, archive));
  await pack();
  await assert.rejects(adaptive.planArchive(archive, scoped), /request logic in main/);
  fs.writeFileSync(path.join(source, '.vite/build/request.js'), snippets[1]);
  await pack();
  const plan = await adaptive.planArchive(archive, scoped);
  assert.equal(plan.targets.length, 2);
  for (const target of plan.targets) {
    patchArchive(archive, target.entry, () => target.patched);
    assert.match(asar.extractFile(archive, target.entry).toString(), /apikey/);
  }
  fs.writeFileSync(path.join(source, '.vite/build/duplicate.js'), snippets[1]);
  await pack();
  await assert.rejects(adaptive.planArchive(archive, scoped), /request logic in main/);
});

test('optional readers accept older apps but reject unrecognized or incomplete newer implementations', async t => {
  const root = temporary(t), source = path.join(root, 'source'), archive = path.join(root, 'app.asar');
  fs.mkdirSync(path.join(source, 'webview'), { recursive: true });
  fs.mkdirSync(path.join(source, '.vite/build'), { recursive: true });
  fs.writeFileSync(path.join(source, 'webview/app.js'), snippets.join('\n'));
  const reader = snippets[1].replace('function request', 'function readServiceTier').replace('!==false;', '!==false&&host!=null;');
  const fn = adaptive.parse(reader).body[0], base = recipes[1];
  const target = adaptive.at(fn, base.path);
  const patched = reader.slice(0, target.start) + adaptive.replacement(reader, fn, target, 'extra-request') + reader.slice(target.end);
  const optional = { ...base, kind: 'extra-request', optional: true, requiredMarker: 'readServiceTier',
    scopes: ['webview', 'main'], fingerprint: adaptive.shape(fn).fingerprint,
    patchedFingerprint: adaptive.shape(adaptive.parse(patched).body[0]).fingerprint };
  const supported = [...recipes, optional];
  const pack = async () => finished(await asar.createPackage(source, archive));
  await pack();
  assert.equal((await adaptive.planArchive(archive, supported)).targets.length, 1);
  const view = path.join(source, 'webview/reader.js'), main = path.join(source, '.vite/build/reader.js');
  fs.writeFileSync(view, reader);
  await pack();
  await assert.rejects(adaptive.planArchive(archive, supported), /extra-request logic in main/);
  fs.writeFileSync(main, reader);
  await pack();
  assert.equal((await adaptive.planArchive(archive, supported)).targets.length, 3);
  fs.writeFileSync(view, reader.replace('host!=null', 'host!==undefined'));
  await pack();
  await assert.rejects(adaptive.planArchive(archive, supported), /extra-request logic in webview/);
  fs.rmSync(main);
  await pack();
  await assert.rejects(adaptive.planArchive(archive, supported), /extra-request logic in webview/);
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

test('monitor applies immediately after exit, reports failure once, then retries a new build', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root, model: 'example-model' });
  let generation = 1;
  let calls = 0;
  const notices = [];
  const options = { now: 100000, stopped: () => {}, getStamp: () => generation, updaterBusy: () => false,
    notifyUser: value => notices.push(value),
    install: async (app, state, config) => { calls++; assert.equal(config.model, 'example-model'); throw new Error('unsupported build'); } };
  const running = await automatic.tick(root, { ...options, stopped: () => { throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); } });
  assert.equal(running.status, 'waiting-for-exit');
  assert.equal(running.adoptUpdate, false);
  assert.equal((await automatic.tick(root, { ...options, stopped: () => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); } })).status, 'process-check-failed');
  assert.equal(calls, 0);
  assert.equal((await automatic.tick(root, options)).status, 'failed');
  assert.equal((await automatic.tick(root, { ...options, now: 200000 })).status, 'rejected-until-next-update');
  assert.equal(calls, 1);
  assert.equal(notices.length, 1);
  generation++;
  const next = { ...options, now: 250000, install: async () => { calls++; return { status: 'installed' }; } };
  assert.equal((await automatic.tick(root, next)).status, 'installed');
  assert.equal((await automatic.tick(root, { ...next, now: 350000 })).status, 'idle');
  assert.equal(calls, 2);
});

test('an update disappearing during failed installation still yields a recorded failure', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  let gone = false;
  const options = { now: 0, stopped: () => {}, updaterBusy: () => false, notifyUser: () => {},
    getStamp: () => { if (gone) throw new Error('updating'); return 1; },
    install: async () => { gone = true; throw new Error('update in progress'); } };
  assert.equal((await automatic.tick(root, options)).status, 'failed');
});

test('LaunchAgent runs the exit observer and only restarts after an unsuccessful exit', () => {
  const plist = automatic.plistDefinition('/stable/node', '/stable/automatic.cjs', '/state');
  assert.deepEqual(plist.ProgramArguments, ['/stable/node', '/stable/automatic.cjs', 'watch', '/state']);
  assert.equal(plist.StartInterval, undefined);
  assert.equal(plist.RunAtLoad, true);
  assert.deepEqual(plist.KeepAlive, { SuccessfulExit: false });
  assert.equal(plist.ProcessType, 'Interactive');
  assert.notEqual(plist.LowPriorityIO, true);
});

test('one-shot restart-now launchd jobs are identified for removal', () => {
  assert.deepEqual(automatic.strayRestartLabels([
    'io.github.infinityf4p.codex-fast-switch',
    'io.github.infinityf4p.codex-fast-switch.restart-now-20260905-0910',
    'io.github.infinityf4p.codex-fast-switch.restart-now',
    'other.restart-now',
  ]), [
    'io.github.infinityf4p.codex-fast-switch.restart-now-20260905-0910',
    'io.github.infinityf4p.codex-fast-switch.restart-now',
  ]);
});

test('monitor waits while Sparkle Autoupdate is replacing the app', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  let updaterChecks = 0;
  const result = await automatic.tick(root, { now: 0, getStamp: () => 1,
    stopped: () => assert.fail('must not inspect processes during an update'),
    updaterBusy: app => { assert.equal(app, root); updaterChecks++; return true; },
    notifyUser: () => assert.fail('Sparkle must not raise a failure dialog'),
    install: async () => assert.fail('must not patch during an update') });
  assert.equal(result.status, 'waiting-for-update');
  assert.equal(result.rejectedStamp, undefined);
  assert.equal(updaterChecks, 1);
});

test('a replaced running app is prepared and restarted under the monitor lock', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  tx.saveJson(automatic.statusPath(root), { successStamp: JSON.stringify(1) });
  const calls = [];
  const result = await automatic.tick(root, { now: 1, getStamp: () => 2, updaterBusy: () => false,
    stopped: () => { throw Object.assign(new Error('running'), { code: 'APP_RUNNING' }); },
    restartApp: async (app, state, options) => {
      assert.equal(app, root);
      assert.equal((await tx.withLock(state, () => assert.fail('restart lock released'))).status, 'busy');
      options.onPhase('staging');
      calls.push('prepare');
      await options.beforeQuit();
      options.onPhase('requesting-quit');
      calls.push('restart');
      return { status: 'installed', reopened: true };
    },
    notifyUser: () => assert.fail('adopting an update must not raise a failure dialog') });
  assert.equal(result.status, 'installed');
  assert.equal(result.successStamp, JSON.stringify(2));
  assert.deepEqual(calls, ['prepare', 'restart']);
});

test('Sparkle helper paths are signed inside-out and skipped when absent', () => {
  const signing = require('../../src/platforms/macos/signing.cjs');
  assert.deepEqual(signing.sparkleTargets('/missing-app'), []);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-sparkle-'));
  try {
    const versioned = path.join(root, 'Contents/Frameworks/Sparkle.framework/Versions/B');
    fs.mkdirSync(path.join(versioned, 'XPCServices'), { recursive: true });
    fs.writeFileSync(path.join(versioned, 'Autoupdate'), '');
    fs.mkdirSync(path.join(versioned, 'Updater.app'));
    fs.mkdirSync(path.join(versioned, 'XPCServices/Installer.xpc'));
    assert.deepEqual(signing.sparkleTargets(root), [
      path.join(versioned, 'XPCServices/Installer.xpc'),
      path.join(versioned, 'Updater.app'),
      path.join(versioned, 'Autoupdate'),
      path.join(root, 'Contents/Frameworks/Sparkle.framework'),
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a quick manual reopen does not reject the build', async t => {
  const root = temporary(t);
  tx.saveJson(automatic.configPath(root), { enabled: true, app: root });
  const result = await automatic.tick(root, { stopped: () => {}, getStamp: () => 1, updaterBusy: () => false,
    install: async () => { throw Object.assign(new Error('reopened'), { code: 'APP_RUNNING' }); },
    notifyUser: () => assert.fail('A normal reopen must not raise a failure dialog') });
  assert.equal(result.status, 'waiting-for-exit');
  assert.equal(result.rejectedStamp, undefined);
});

test('probe environment strips credentials, provider overrides, proxies and Node injection', () => {
  const env = probeEnvironment('/temporary', { HOME: '/real', CODEX_HOME: '/real/codex', OPENAI_API_KEY: 'sensitive',
    OPENAI_BASE_URL: 'https://external.invalid', HTTPS_PROXY: 'https://external.invalid', NODE_OPTIONS: '--require unwanted', AWS_ACCESS_KEY_ID: 'sensitive' });
  for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HTTPS_PROXY', 'NODE_OPTIONS', 'AWS_ACCESS_KEY_ID']) assert.equal(env[name], undefined);
  assert.equal(env.HOME, '/temporary');
  assert.equal(env.CODEX_HOME, path.join('/temporary', 'codex'));
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
