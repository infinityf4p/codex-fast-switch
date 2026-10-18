const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const asar = require('@electron/asar');
const { finished } = require('node:stream/promises');
const a = require('../../src/core/adaptive.cjs');
const contract = require('../../src/core/recipes.json').find(r => r.kind === 'request');
const fixture = require('../support/request-preparer.cjs');
const { snippets, recipes } = require('../support/fixtures.cjs');

test('submission contracts tolerate unrelated request metadata and imports while checking the actual selector', async () => {
  for (const source of [fixture, fixture.replaceAll('client', 'renamedClient').replaceAll('tier', 'chosenSpeed'),
    fixture.replace('rootTurnId: message.rootTurnId', 'rootTurnId: message.rootTurnId, futureField: otherModule.renamedExport(message)')]) {
    const result = a.adapt(source, [contract]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].recipe.anyScope, false);
    assert.deepEqual(result.matches[0].recipe.scopes, ['webview', 'main']);
    const checks = await require('../../src/core/request-gate.cjs').validate(result.matches[0], a);
    assert.equal(checks.length, 14);
    assert.ok(checks.every(check => check.passed));
    // The edit is exactly the account-type condition; all surrounding bytes survive.
    assert.equal(result.patched.replace("(identity?.type === 'chatgpt'||identity?.type===\"apiKey\")", "identity?.type === 'chatgpt'"), source);
  }
});

test('Fast and Standard reach resume, start and steer without changing request fields, policy or saved defaults', async () => {
  const source = a.adapt(fixture, [contract]).patched;
  const factory = vm.runInNewContext(`(${source})`);
  for (const auth of ['apiKey', 'chatgpt', 'other', null]) for (const tier of ['priority', null]) {
    let accountReads = 0;
    const client = { getConversation: () => ({ latestModel: 'selected-model' }),
      getAccount: async options => {
        assert.equal(options.priority, 'critical'); accountReads++;
        return { account: auth == null ? null : { type: auth } };
      } };
    const prepare = factory(client, { settings: { readPermissionRefreshEnabled: async () => true } },
      async model => { assert.equal(model, 'selected-model'); return tier; }, () => 'id', async () => {});
    const message = { submissionOptions: { serviceTier: tier }, model: 'selected-model',
      parentTurnId: 'parent', rootTurnId: 'root', input: [{ text: 'test' }] };
    const result = await prepare('thread', message);
    const expected = ['apiKey', 'chatgpt'].includes(auth) ? tier : null;
    assert.equal(result.submission.resume.serviceTier, expected);
    assert.equal(result.submission.start.request.serviceTier, expected);
    assert.equal(result.submission.steer.serviceTier, expected);
    assert.equal(result.submission.start.request.parentTurnId, 'parent');
    assert.equal(result.submission.start.request.rootTurnId, 'root');
    assert.equal(result.submission.start.request.model, message.model);
    assert.equal(result.submission.start.request.input, message.input);
    assert.equal(result.submission.start.context.original, message);
    const before = accountReads;
    assert.equal((await prepare('thread', { ...message, blocked: true })).status, 'paused');
    assert.equal(accountReads, before);
    const saved = await prepare('thread', { ...message, submissionOptions: null });
    assert.equal(saved.submission.start.request.serviceTier, tier);
    assert.equal(accountReads, before);
  }
});

test('unreviewed authentication and broken request bindings are rejected', () => {
  for (const changed of [
    fixture.replace("identity?.type === 'chatgpt'", "identity?.type !== 'other'"),
    fixture.replace("priority: 'critical'", "priority: 'background'"),
    fixture.replace('client.getAccount', 'differentClient.getAccount'),
    fixture.replace('message.submissionOptions', 'message.otherOptions'),
    fixture.replace('serviceTier: tier, input: message.input', 'serviceTier: otherTier, input: message.input'),
    fixture.replace('client.getConversation(threadId)', 'client.getConversation(otherThread)'),
    fixture.replace('return readSavedTier(', 'return otherSavedTier('),
    fixture.replace('threadId: threadId', 'threadId: otherThread'),
  ]) assert.equal(a.adapt(changed, [contract]).matches.length, 0);
});

test('split main and renderer preparers both get patched; missing or duplicate copies remain errors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-request-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), archive = path.join(root, 'app.asar');
  fs.mkdirSync(path.join(source, '.vite/build'), { recursive: true });
  fs.mkdirSync(path.join(source, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(source, 'webview/ui.js'), snippets[0]);
  const native = 'function nativeModels(){const additionalAvailableModels=true;return additionalAvailableModels;}';
  const fingerprint = a.shape(a.parse(native).body[0]).fingerprint;
  fs.writeFileSync(path.join(source, 'webview/models.js'), native);
  const variants = [recipes[0], contract, { kind: 'models', native: true, requiredMarker: 'additionalAvailableModels',
    fingerprint, patchedFingerprint: fingerprint }];
  const main = path.join(source, '.vite/build/main.js'), renderer = path.join(source, 'webview/renderer.js');
  fs.writeFileSync(main, fixture); fs.writeFileSync(renderer, fixture.replace('prepareSubmission', 'prepareRenderer'));
  const plan = async (selected = variants) => { await finished(await asar.createPackage(source, archive)); return a.planArchive(archive, selected); };
  const result = await plan();
  assert.equal(result.targets.filter(t => t.kinds.includes('request')).length, 2);
  assert.equal(result.targets.some(t => t.entry.endsWith('models.js')), false);
  assert.equal(result.checks.filter(c => c.kind === 'request').length, 28);
  fs.unlinkSync(main);
  await assert.rejects(plan(), /request logic in main/);
  fs.writeFileSync(main, fixture);
  fs.unlinkSync(renderer);
  await assert.rejects(plan(), /request logic in webview/);
  const reviewed = { ...contract, fingerprint: a.shape(a.parse(fixture).body[0]).fingerprint, compatibleFingerprints: [] };
  assert.equal((await plan([variants[0], reviewed, variants[2]])).targets.filter(t => t.kinds.includes('request')).length, 1);
  fs.writeFileSync(renderer, fixture + fixture.replace('prepareSubmission', 'otherPreparer'));
  await assert.rejects(plan(), /request logic in webview/);
});
