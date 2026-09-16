const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { adaptPicker } = require('../../src/core/picker.cjs');

// Native functions shared by the reviewed 7982 and 8576 archives.
function G3a(e,{stripGptPrefix:t=!1}={}){if(!e.trimStart().toLowerCase().startsWith(`gpt`))return e;let n=/^gpt-\d/iu.test(e.trimStart())?` `:`-`,r=e.split(/(\s+)/).map(e=>e.trim().length===0?e:e.split(`-`).map((e,t)=>e.toLowerCase()===`gpt`?`GPT`:e.toLowerCase()===`oai`?`OAI`:t>0&&e.length>0?`${e[0]?.toUpperCase()??``}${e.slice(1)}`:e).join(n).replace(/^GPT (?=\d)/u,`GPT-`)).join(``);return t?r.replace(/^GPT-/iu,``):r}
function q3a(e,{includeUltraInSlider:t=!1,removeXHigh:n=!1,sliderModelsConfig:r,stripGptPrefix:i=!0}={}){if(r!=null){let a=X3a(e,{stripGptPrefix:i});for(let o of r.presets){let r=(0,t6a.default)(e6a(o.filter(({reasoning_effort:e})=>(t||e!==`ultra`)&&(!n||e!==`xhigh`)).flatMap(({model:e,reasoning_effort:t})=>{let n=a.find(n=>n.model===e&&n.reasoningEffort===t);return n==null?[]:[n]}),e,i),({id:e})=>e);if(r.length>=3)return r}}let a=e6a((t?[...r6a,i6a]:r6a).filter(({reasoningEffort:e})=>!n||e!==`xhigh`),e,i);if(a.length>=3)return a;let o=e6a(a6a.filter(({reasoningEffort:e})=>!n||e!==`xhigh`),e,i);return o.length>=3?o:[]}
const source = `${G3a}\n${q3a}`;
const choices = (model, efforts) => efforts.map(reasoningEffort => ({ id: `${model}:${reasoningEffort}`, model, reasoningEffort }));
const models = [
  { model: 'gpt-5.6-terra', displayName: 'gpt-5.6-terra' },
  { model: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
  { model: 'gpt-6-astra', displayName: 'gpt-6-astra' },
].map(model => ({ ...model, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'ultra'].map(reasoningEffort => ({ reasoningEffort })) }));

function runtime() {
  const context = vm.createContext({
    t6a: { default: (items, key) => [...new Map(items.map(item => [key(item), item])).values()] },
    r6a: [...choices('gpt-5.6-terra', ['low']), ...choices('gpt-5.6-sol', ['low', 'medium', 'high', 'xhigh'])],
    i6a: choices('gpt-5.6-sol', ['ultra'])[0],
    a6a: choices('gpt-5.6-terra', ['low', 'medium', 'high', 'xhigh']),
    X3a: catalog => catalog?.flatMap(model => choices(model.model, model.supportedReasoningEfforts.map(item => item.reasoningEffort))) ?? [],
    e6a: (presets, catalog, strip) => presets.flatMap((preset, powerSettingIndex) => {
      const model = catalog?.find(model => model.model === preset.model &&
        model.supportedReasoningEfforts.some(item => item.reasoningEffort === preset.reasoningEffort));
      return model ? [{ ...preset, powerSettingIndex, modelLabel: context.G3a(model.displayName, { stripGptPrefix: strip }) }] : [];
    }),
  });
  vm.runInContext(adaptPicker(source).patched, context, { timeout: 1000 });
  return context;
}
const ids = items => Array.from(items, item => item.id);

test('model labels retain the GPT prefix across stripped and full-name callers', () => {
  const { G3a: format } = runtime();
  for (const stripGptPrefix of [true, false]) {
    for (const [input, expected] of [['gpt-6-astra', 'GPT-6 Astra'], ['GPT-5.6 Sol', 'GPT-5.6 Sol'],
      ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna'], ['GPT-5.5', 'GPT-5.5'], ['Custom Model', 'Custom Model']]) {
      assert.equal(format(input, { stripGptPrefix }), expected);
    }
  }
});

test('Default uses the five confirmed model and effort pairs without an account preset', () => {
  const { q3a: select } = runtime();
  const expected = ['gpt-5.6-terra:low', 'gpt-5.6-sol:low', 'gpt-5.6-sol:medium', 'gpt-6-astra:low', 'gpt-6-astra:medium'];
  for (const sliderModelsConfig of [undefined, null]) {
    const result = select(models, { sliderModelsConfig });
    assert.deepEqual(ids(result), expected);
    assert.deepEqual(Array.from(result, item => item.powerSettingIndex), [0, 1, 2, 3, 4]);
    assert.ok(result.every(item => item.modelLabel.startsWith('GPT-')));
    assert.deepEqual(ids(select(models, { sliderModelsConfig, includeUltraInSlider: true })), expected);
  }
});

test('account presets retain their order, deduplication and native Ultra/XHigh controls', () => {
  const { q3a: select } = runtime();
  const sliderModelsConfig = { presets: [[
    { model: 'gpt-6-astra', reasoning_effort: 'medium' },
    { model: 'gpt-5.6-sol', reasoning_effort: 'low' },
    { model: 'gpt-5.6-sol', reasoning_effort: 'low' },
    { model: 'gpt-5.6-terra', reasoning_effort: 'high' },
    { model: 'gpt-6-astra', reasoning_effort: 'ultra' },
    { model: 'gpt-6-astra', reasoning_effort: 'xhigh' },
  ]] };
  const before = structuredClone(sliderModelsConfig);
  const base = ['gpt-6-astra:medium', 'gpt-5.6-sol:low', 'gpt-5.6-terra:high'];
  assert.deepEqual(ids(select(models, { sliderModelsConfig })), [...base, 'gpt-6-astra:xhigh']);
  assert.deepEqual(ids(select(models, { sliderModelsConfig, includeUltraInSlider: true, removeXHigh: true })), [...base, 'gpt-6-astra:ultra']);
  assert.deepEqual(sliderModelsConfig, before);
});

test('Default filters unsupported choices and retains the native small-catalog fallback', () => {
  const { q3a: select } = runtime();
  assert.deepEqual(ids(select(models.slice(0, 2))), ['gpt-5.6-terra:low', 'gpt-5.6-sol:low', 'gpt-5.6-sol:medium']);
  assert.deepEqual(ids(select(models.slice(0, 1))), ['gpt-5.6-terra:low', 'gpt-5.6-terra:medium', 'gpt-5.6-terra:high', 'gpt-5.6-terra:xhigh']);
  const limited = structuredClone(models);
  limited[2].supportedReasoningEfforts = [{ reasoningEffort: 'low' }];
  assert.deepEqual(ids(select(limited)), ['gpt-5.6-terra:low', 'gpt-5.6-sol:low', 'gpt-5.6-sol:medium', 'gpt-6-astra:low']);
  assert.deepEqual(ids(select([])), []);
});

test('picker adaptation is idempotent, supports split chunks and rejects ambiguous or unknown shapes', () => {
  const first = adaptPicker(source.replaceAll('G3a', 'modelLabel').replaceAll('q3a', 'defaultChoices'));
  assert.equal(first.matches.length, 2);
  assert.ok(first.matches.every(item => item.changed));
  const second = adaptPicker(first.patched);
  assert.equal(second.patched, first.patched);
  assert.ok(second.matches.every(item => !item.changed));
  assert.equal(adaptPicker(G3a.toString()).matches.length, 1);
  assert.equal(adaptPicker(q3a.toString()).matches.length, 1);
  assert.throws(() => adaptPicker(`${source}\n${G3a.toString().replace('G3a', 'duplicate')}`), /uniquely recognize model-name/);
  assert.equal(adaptPicker(q3a.toString().replaceAll('>=3', '>=4')).matches.length, 0);
  const recipes = structuredClone(require('../../src/core/picker-recipe.json'));
  recipes[1].presets[0].pop();
  assert.throws(() => adaptPicker(source, recipes), /Unexpected transformed default-model-presets/);
});
