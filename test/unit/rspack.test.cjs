const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parse, shape } = require('../../src/core/adaptive.cjs');
const { modules, collect, plan } = require('../../src/core/rspack.cjs');

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
