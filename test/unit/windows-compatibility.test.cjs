const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSignatures } = require('../../src/platforms/windows/signatures.cjs');
const { planWindowsArchive } = require('../../src/platforms/windows/plan.cjs');
const { adapt } = require('../../src/platforms/windows/updater.cjs');
const { parse, shape } = require('../../src/core/adaptive.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modern = fs.readFileSync(path.join(__dirname, '../fixtures/windows-updater-27194.js'), 'utf8');
const recent = modern.replace('onInstallUpdatesAborted:',
  'onIdleInstallRegistered:()=>this.onIdleWindowsInstallRegistered?.(),onInstallUpdatesAborted:');

test('future signed runtime versions are accepted without a per-build hash list', () => {
  const files = ['ChatGPT.exe', 'chrome.dll', 'resources/codex.exe'];
  const signatures = files.map(file => ({ file, status: 'Valid', subject: 'CN=OpenAI, O="OpenAI OpCo, LLC", C=US',
    fileVersion: '200.1.2.3', productName: 'Codex' }));
  const validate = entries => validateSignatures(files, entries, { matchingRuntime: true });
  validate(signatures);
  const changed = (index, extra) => signatures.map((entry, i) => i === index ? { ...entry, ...extra } : entry);
  for (let index = 0; index < files.length; index++) {
    assert.throws(() => validate(changed(index, { status: 'HashMismatch' })), /signatures/);
    assert.throws(() => validate(changed(index, { subject: 'CN=Other, O=Other Company, C=US' })), /signatures/);
  }
  assert.throws(() => validate(signatures.slice(1)), /signatures/);
  assert.throws(() => validate(signatures.toReversed()), /signatures/);
  assert.throws(() => validate(changed(0, { fileVersion: '' })), /same runtime version/);
  assert.throws(() => validate(changed(1, { fileVersion: '199.1.2.3' })), /same runtime version/);
  assert.throws(() => validate(changed(1, { productName: 'Other runtime' })), /same runtime version/);
  assert.throws(() => validate(changed(0, { status: 'NotSigned' })), /signatures/);
  // Only the older embedded-manifest path explicitly permits its rewritten EXE.
  validateSignatures(files, changed(0, { status: 'NotSigned' }), { unsignedExecutable: true });
});

const manager = `class Manager {
  async initializeWindowsUpdater() {
    const native = loadNative();
    const next = new WindowsUpdater(native, {
      onUpdateReadyChanged: value => this.setUpdateReady(value),
      onUpdateLifecycleStateChanged: state => this.setUpdateLifecycleState(state)
    });
    await next.initialize();
    if (!next.hasUpdater()) return;
    this.updater = next;
    this.setUpdateReady(next.getIsUpdateReady());
  }
  setUpdateReady(value) { this.ready = value; this.options.onUpdateReadyChanged?.(value); }
  setUpdateLifecycleState(state) { this.lifecycle = state; this.options.onUpdateLifecycleStateChanged?.(state); }
  getIsUpdateReady() { return this.ready; }
  async checkForUpdates() { await this.policy; return this.updater.checkForUpdates(); }
  async installUpdatesIfAvailable() { await this.policy; return this.updater.installUpdatesIfAvailable(); }
  initializeMacUpdater() { return 'preserved'; }
}`;

test('updater contracts accept implementation changes and renaming while preserving the public manager', () => {
  for (const source of [manager, manager.replace('loadNative()', 'loadNewNative({channel:"stable"})'),
    manager.replace('await next.initialize();', 'await next.initialize(); log("initialized");').replaceAll('next', 'renamed')]) {
    const patched = adapt(source, { state: 'state', id: 'id' }, new Set()).toString();
    const methods = text => parse(text).body[0].body.body;
    assert.notEqual(shape(methods(source)[0]).fingerprint, shape(methods(patched)[0]).fingerprint);
    assert.deepEqual(methods(source).slice(1).map(shape), methods(patched).slice(1).map(shape));
  }
});

test('unknown updater interfaces and ambiguous managers are not patched', () => {
  for (const source of [
    manager.replace('this.options.onUpdateReadyChanged?.(value)', 'this.options.onUpdateReadyChanged?.(false)'),
    manager.replace('this.setUpdateLifecycleState(state)', 'this.setUpdateLifecycleState("idle")'),
    manager.replace('this.updater.installUpdatesIfAvailable()', 'this.updater.installUpdatesIfAvailable({force:true})'),
    manager.replace('async checkForUpdates()', 'async checkForUpdates(required)'),
    manager.replace('return this.ready', 'return this.other'),
    manager.replace('await next.initialize()', 'await next.start()'),
    manager.replace('async initializeWindowsUpdater()', 'static async initializeWindowsUpdater()'),
    manager + manager.replace('class Manager', 'class Other'),
  ]) assert.throws(() => adapt(source, {}, new Set()), { code: 'UNSUPPORTED_UPDATER' });
});

test('the reviewed Rspack updater preserves native operations and changes only Windows initialization', () => {
  for (const source of [modern, recent].flatMap(text => [text, text.replaceAll('"', "'").replaceAll('let ', 'let  ')])) {
    const patched = adapt(source, { state: 'state', id: 'generation' }, new Set()).toString();
    const methods = text => parse(text).body[0].body.body;
    const unchanged = text => methods(text).filter(m => m.key.name !== 'initializeWindowsUpdater').map(shape);
    assert.deepEqual(unchanged(patched), unchanged(source));
    assert.match(patched, /this\.updater=/);
  }
  for (const changed of [
    recent.replace('this.onIdleWindowsInstallRegistered?.()', 'this.quit()'),
    modern.replace('return this.isUpdateReady&&', 'return this.other&&'),
    modern.replace('await t.checkForUpdates(e)', 'await t.checkForUpdates()'),
    modern.replace('await n.installUpdatesIfAvailable(e,t)', 'await n.installUpdatesIfAvailable("auto",t)'),
    modern.replace('this.options.onUpdateReadyChanged?.(e)', 'this.options.onUpdateReadyChanged?.(false)'),
    modern.replace('this.options.onUpdateLifecycleStateChanged?.(e)', 'this.options.onUpdateLifecycleStateChanged?.("ready")'),
    modern.replace('onInstallReadinessChanged:e=>this.setUpdateReady(e)', 'onInstallReadinessChanged:e=>this.setUpdateReady(true)'),
    modern + modern.replace('class Manager', 'class Other'),
  ]) assert.throws(() => adapt(changed, {}, new Set()), { code: 'UNSUPPORTED_UPDATER' });
});

test('modern native readiness requires the ready lifecycle and forwards operation arguments and failure', async () => {
  const Manager = vm.runInNewContext(modern + ';Manager', { process: { platform: 'win32' } });
  const manager = new Manager();
  let aborted = 0;
  const calls = [];
  manager.options = { onInstallUpdatesAborted: () => { aborted++; } };
  manager.setUpdateDownloaded = manager.applyPendingSparkleQueryParams = manager.scheduleForcedUpdateInstall = () => {};
  manager.logger = { error: () => assert.fail('unexpected native updater error') };
  manager.updater = {
    checkForUpdates: async reason => calls.push(['check', reason]),
    installUpdatesIfAvailable: async (...args) => { calls.push(['install', ...args]); return false; },
  };
  manager.setUpdateReady(true);
  manager.setUpdateLifecycleState('downloading');
  assert.equal(manager.getIsUpdateReady(), false);
  manager.setUpdateLifecycleState('ready');
  assert.equal(manager.getIsUpdateReady(), true);
  await manager.checkForUpdates('menu');
  assert.equal(await manager.installUpdatesIfAvailable('user', 'menu'), false);
  assert.equal(aborted, 1);
  assert.deepEqual(calls, [['check', 'menu'], ['install', 'user', 'menu']]);
  manager.updater.installUpdatesIfAvailable = async () => true;
  assert.equal(await manager.installUpdatesIfAvailable(), true);
  manager.setUpdateReady(false);
  assert.equal(manager.getIsUpdateReady(), false);
});

test('a changed Windows layout retains the matching model names, filled icon and Fast checks', async () => {
  const calls = [];
  const prepared = { targets: [{ entry: 'request.js' }, { entry: 'appearance.js', kinds: ['model-name', 'fast-icon'] }],
    checks: ['Fast sends priority', 'Standard omits tier'] };
  const result = await planWindowsArchive('original.asar', { plan: async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw Object.assign(new Error('Changed native layout'),
      { code: 'UNSUPPORTED_APPEARANCE', appearance: 'compact-model-control' });
    return prepared;
  } });
  assert.deepEqual(calls, [['original.asar'], ['original.asar', undefined, undefined, null,
    require('../../src/core/picker-recipe.json'), true]]);
  assert.deepEqual(result.targets, prepared.targets);
  assert.deepEqual(result.checks, prepared.checks);
  assert.equal(result.compatibility.nativeAppearance, true);
  assert.deepEqual(result.compatibility.nativeAppearanceFeatures, ['compact-model-control']);
});

test('unknown compact colors fall back independently without removing model names or the filled icon', async () => {
  let calls = 0;
  const result = await planWindowsArchive('original.asar', { plan: async (_archive, _gates, icon, compact, picker, colors) => {
    if (++calls <= 2) throw Object.assign(new Error('Changed appearance'), {
      code: 'UNSUPPORTED_APPEARANCE', appearance: calls === 1 ? 'compact-model-control' : 'compact-colors',
    });
    assert.equal(icon, undefined);
    assert.equal(compact, null);
    assert.equal(colors, false);
    assert.ok(picker.some(recipe => recipe.kind === 'model-name'));
    return { targets: [], checks: ['required Fast checks'] };
  } });
  assert.deepEqual(result.compatibility.nativeAppearanceFeatures, ['compact-model-control', 'compact-colors']);
  assert.equal(result.compatibility.compactColors, false);
  assert.deepEqual(result.checks, ['required Fast checks']);
});

test('independent appearance failures retain unaffected transforms and cannot loop on the same failure', async () => {
  const failures = ['fast-icon', 'default-model-presets'];
  const result = await planWindowsArchive('original.asar', { plan: async (_archive, _gates, icon, compact, picker) => {
    const feature = failures.shift();
    if (feature) throw Object.assign(new Error(feature), { code: 'UNSUPPORTED_APPEARANCE', appearance: feature });
    assert.equal(icon, null);
    assert.equal(compact, undefined);
    assert.deepEqual(picker.map(recipe => recipe.kind), ['model-name']);
    return { targets: [], checks: [] };
  } });
  assert.deepEqual(result.compatibility.nativeAppearanceFeatures, ['fast-icon', 'default-model-presets']);
  for (const appearance of ['compact-model-control', 'model-picker', 'unknown-feature']) {
    let calls = 0;
    const failure = Object.assign(new Error('Repeated or unknown failure'), { code: 'UNSUPPORTED_APPEARANCE', appearance });
    await assert.rejects(planWindowsArchive('original.asar', { plan: async () => { calls++; throw failure; } }), error => error === failure);
    assert.equal(calls, appearance === 'unknown-feature' ? 1 : 2);
  }
});

test('appearance fallback cannot suppress unsupported Fast request logic', async () => {
  for (const appearanceFirst of [false, true]) {
    let calls = 0;
    const failure = new Error('Unsupported Fast request');
    await assert.rejects(planWindowsArchive('original.asar', { plan: async () => {
      if (++calls === 1 && appearanceFirst) throw Object.assign(new Error('Changed layout'),
        { code: 'UNSUPPORTED_APPEARANCE', appearance: 'compact-model-control' });
      throw failure;
    } }), error => error === failure);
    assert.equal(calls, appearanceFirst ? 2 : 1);
  }
});
