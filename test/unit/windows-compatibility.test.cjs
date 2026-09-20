const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSignatures } = require('../../src/platforms/windows/signatures.cjs');
const { planWindowsArchive } = require('../../src/platforms/windows/plan.cjs');
const { adapt } = require('../../src/platforms/windows/updater.cjs');
const { parse, shape } = require('../../src/core/adaptive.cjs');

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
