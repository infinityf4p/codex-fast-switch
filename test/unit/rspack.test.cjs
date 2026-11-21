const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parse, shape, nodePath } = require('../../src/core/adaptive.cjs');
const { modules, collect, plan, validate } = require('../../src/core/rspack.cjs');

const source = 'function(name,{stripGptPrefix=false}={}){return stripGptPrefix?name.replace(/^GPT-/,""):name;}';
const patched = 'function(name,{stripGptPrefix=false}={}){return name;}';
const fingerprint = text => shape(parse(`(${text})`).body[0].expression).fingerprint;
const recipe = { kind: 'model-name', module: 'Label', scope: 'webview',
  fingerprint: fingerprint(source), patchedFingerprint: fingerprint(patched), path: ['body', 'body', 0, 'argument'] };
const chunk = (name, implementation = source) => ({ entry: `webview/assets/async/${name}.js`, scope: 'webview',
  source: `export const __rspack_esm_ids=[1];export const __webpack_modules__={Label(module,exports,require){exports.format=${implementation};},Other(){return 42;}};` });

test('Rspack applies every lazy copy and retains unrelated modules and native exports', async () => {
  const entries = [chunk('first'), chunk('second')];
  const result = await plan(entries, [recipe]);
  assert.equal(result.targets.length, 2);
  for (const target of result.targets) {
    const text = target.patched.toString();
    assert.equal(text, entries.find(e => e.entry === target.entry).source.replace(source, patched));
    const exported = {};
    const factory = modules(text).get('Label');
    vm.runInNewContext(`(function${text.slice(factory.start, factory.end)})(null,exports,null)`, { exports: exported });
    assert.equal(exported.format('GPT-6 Astra', { stripGptPrefix: true }), 'GPT-6 Astra');
  }
});

test('Rspack module IDs survive quote, binding and whitespace changes without using chunk names', () => {
  const entry = chunk('renamed');
  entry.source = entry.source.replace('Label(module', '"Label" ( module').replaceAll('name', 'modelName');
  assert.equal(collect([entry], [recipe]).length, 1);
  const table = modules('"use strict";exports.ids=[1],exports.modules={123(m){m.exports=42;}};');
  assert.equal(table.size, 1);
  assert.ok(table.has('123'));
});

test('Rspack rejects an unknown lazy copy, missing module, ambiguous target and duplicate registry key', async () => {
  await assert.rejects(plan([chunk('good'), chunk('changed', source.replace('replace(', 'replaceAll('))], [recipe]), /Cannot recognize/);
  await assert.rejects(plan([{ ...chunk('missing'), source: 'export const __webpack_modules__={};' }], [recipe]), /Missing Rspack/);
  const duplicate = chunk('ambiguous');
  duplicate.source = duplicate.source.replace('exports.format=', `exports.second=${source};exports.format=`);
  assert.throws(() => collect([duplicate], [recipe]), /Cannot recognize/);
  assert.throws(() => modules('export const __webpack_modules__={Label(){},Label(){}}'), /Duplicate Rspack/);
  assert.throws(() => modules('export const __webpack_modules__={["Label"](){}}'), /Unsupported Rspack/);
});

test('Rspack checks main and renderer independently and verifies the resulting function', async () => {
  const both = [recipe, { ...recipe, scope: 'main' }];
  await assert.rejects(plan([chunk('renderer')], both), /Missing Rspack.*main/);
  const main = { ...chunk('main'), entry: '.vite/build/chunk.js', scope: 'main' };
  assert.equal((await plan([main, chunk('renderer')], both)).targets.length, 2);
  await assert.rejects(plan([chunk('invalid')], [{ ...recipe, patchedFingerprint: 'invalid' }]), /Unexpected Rspack/);
});

test('Rspack accepts reviewed module variants without ignoring an unknown copy of either variant', async () => {
  const variants = [{ ...recipe, compatibleVariants: [{ module: 'OlderLabel' }] }];
  const older = { ...chunk('older'), source: chunk('older').source.replace('Label(', 'OlderLabel(') };
  assert.equal((await plan([older], variants)).targets.length, 1);
  assert.equal((await plan([older, chunk('newer')], variants)).targets.length, 2);
  const changed = { ...older, source: older.source.replace('replace(', 'replaceAll(') };
  await assert.rejects(plan([changed, chunk('good')], variants), /Cannot recognize/);
  await assert.rejects(plan([older, chunk('bad', source.replace('replace(', 'replaceAll('))], variants), /Cannot recognize/);
});

test('a shipped standalone app-server host must receive the speed adapter', async () => {
  const launcher = 'function launch(options){const cli=options.cli;return {executablePath:cli.executablePath,args:options.args,env:options.env}}';
  const fn = parse(launcher).body[0];
  const { inject } = require('../../src/core/backend-speed.cjs');
  const edited = inject(launcher, fn);
  const host = { entry: '.vite\\build\\app-server-host.js', scope: 'main', source: `${launcher};exports.launch=launch;` };
  const utility = { kind: 'api-ultrafast-backend', entry: '.vite/build/app-server-host.js', scope: 'main',
    fingerprint: shape(fn).fingerprint, patchedFingerprint: fingerprint(edited) };
  const recipes = [recipe, utility];
  const renderer = chunk('renderer');
  const other = { ...host, entry: '.vite/build/other.js' };
  assert.deepEqual((await plan([renderer, other], recipes)).targets.map(t => t.entry), [renderer.entry]);
  const result = await plan([renderer, host], recipes);
  assert.deepEqual(result.targets.map(t => t.entry), [renderer.entry, host.entry]);
  assert.equal(result.targets[1].patched.toString(), `${edited};exports.launch=launch;`);
  await assert.rejects(plan([renderer, { ...host, source: host.source.replace('options.env', 'options.other') }], recipes),
    /Cannot recognize Rspack api-ultrafast-backend in standalone entry/);
});

test('a reviewed native model query is retained byte for byte while other lazy modules are patched', async () => {
  const native = 'function(config){return {models:config.models,provider:config.provider};}';
  const query = { kind: 'api-configured-model', module: 'Catalog', scope: 'webview', fingerprint: 'older-query',
    compatibleVariants: [{ fingerprint: fingerprint(native), native: true, patchedFingerprint: fingerprint(native) }] };
  const entry = chunk('native-catalog');
  entry.source = entry.source.replace('Other(){return 42;}', `Catalog(m){m.exports=${native};}`);
  const result = await plan([entry], [recipe, query]);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].patched.toString(), entry.source.replace(source, patched));
  await assert.rejects(plan([{ ...entry, source: entry.source.replace('config.provider', 'config.otherProvider') }],
    [recipe, query]), /Cannot recognize Rspack api-configured-model/);
});

test('request validation preserves conversation-based saved speed and explicit Standard/Fast/Ultrafast selections', async () => {
  const source = `function(client,saved){return async(conversationId,message)=>{
    const options=message.submissionOptions;
    const tier=await (async()=>{
      if(null==options)return saved(conversationId);
      if(null==options.serviceTier)return null;
      const {account}=await client.getAccount({priority:'critical'});
      return account?.type==='chatgpt'||account?.type==='amazonBedrock'||account?.type==='apiKey'?options.serviceTier:null;
    })();
    return {resume:{serviceTier:tier},start:{serviceTier:tier},steer:{serviceTier:tier}};
  }}`;
  const fn = parse(`(${source})`).body[0].expression;
  let condition;
  require('acorn-walk').simple(fn, { ConditionalExpression(node) { condition = node.test; } });
  const recipe = { kind: 'request', savedScope: 'conversation', path: nodePath(fn, condition) };
  const checks = await validate({ recipe, patchedFunction: source });
  assert.equal(checks.length, 23);
  assert.ok(checks.every(check => check.passed));
  await assert.rejects(validate({ recipe, patchedFunction: source.replace('saved(conversationId)', 'saved("wrong")') }),
    /Unknown saved-tier conversation argument/);
  await assert.rejects(validate({ recipe, patchedFunction: source.replace('||account?.type===\'apiKey\'', '') }),
    /request gate verification failed/);
});
