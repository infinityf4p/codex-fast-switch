const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adapt } = require('../../src/platforms/macos/update-hook.cjs');
const { parse } = require('../../src/core/adaptive.cjs');

const source = 'class Updater{async initializeMacSparkle(){let addon;try{addon=load((0,p.join)(process.resourcesPath,`native`,`sparkle.node`))}catch(e){}addon.init("feed")}}';

test('updater adaptation loads the native hook after the addon but before initialization', () => {
  const result = adapt(source);
  assert.ok(result.includes('import("objc-js")'));
  assert.ok(result.indexOf('installWithConfigurationAtPath$') < result.indexOf('addon.init'));
  assert.ok(result.endsWith('}catch(e){}addon.init("feed")}}'));
  parse(result);
});

test('updater adaptation accepts renamed imports and rejects ambiguous or non-async owners', () => {
  parse(adapt(source.replace('load(', 'renamed(').replace('p.join', 'other.join')));
  assert.throws(() => adapt(source.replace('async ', '')), /uniquely recognize/);
  assert.throws(() => adapt(source + source.replace('Updater', 'Other')), /uniquely recognize/);
  assert.throws(() => adapt(source.replace('addon=load', 'addon=()=>load')), /uniquely recognize/);
  assert.throws(() => adapt(adapt(source)), /uniquely recognize/);
});
