const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { adaptFastIcon, parse, shape } = require('../lib/adaptive.cjs');

const outlinePath = 'M0 0 H20 V20 H0 Z M4 4 V16 H16 V4 Z';
const solidPath = 'M0 0 H24 V24 H0 Z';
const outline = `props=>jsx("svg",{width:20,height:20,viewBox:"0 0 20 20",...props,children:jsx("path",{d:"${outlinePath}",fill:"currentColor"})})`;
const solid = `options=>render("svg",{width:24,height:24,viewBox:"0 0 24 24",...options,children:render("path",{d:"${solidPath}",fill:"currentColor"})})`;
const expected = outline.replace('0 0 20 20', '0 0 24 24').replace(outlinePath, solidPath);
const fingerprint = expression => shape(parse(`(${expression})`).body[0].expression).fingerprint;
const recipe = { sourceFingerprint: fingerprint(outline), solidFingerprint: fingerprint(solid), patchedFingerprint: fingerprint(expected) };
const source = `const legacy=${outline};const filled=${solid};`;

test('filled Fast glyph retains the legacy icon dimensions and forwarded props', () => {
  const result = adaptFastIcon(source, recipe);
  assert.equal(result.changed, true);
  const tree = vm.runInNewContext(`${result.patched};legacy({className:"icon-2xs", "aria-hidden":true})`, {
    jsx: (tag, props) => ({ tag, ...props }),
  });
  assert.equal(tree.width, 20);
  assert.equal(tree.height, 20);
  assert.equal(tree.className, 'icon-2xs');
  assert.equal(tree['aria-hidden'], true);
  assert.equal(tree.viewBox, '0 0 24 24');
  assert.equal(tree.children.d, solidPath);
  assert.equal(tree.children.fill, 'currentColor');
});

test('reapplying the filled icon patch leaves the source unchanged', () => {
  const first = adaptFastIcon(source, recipe);
  assert.deepEqual(adaptFastIcon(first.patched, recipe), { patched: first.patched, matched: true, changed: false });
});

test('unknown and ambiguous icons cannot be silently replaced', () => {
  const changed = source.replace(outlinePath, 'M1 1 H19 V19 Z');
  assert.deepEqual(adaptFastIcon(changed, recipe), { patched: changed, matched: false, changed: false });
  assert.throws(() => adaptFastIcon(`${source}const duplicate=${outline};`, recipe), /uniquely recognize/);
  assert.throws(() => adaptFastIcon(`const legacy=${outline};`, recipe), /filled Fast icon is unavailable/);
  assert.throws(() => adaptFastIcon(source, { ...recipe, patchedFingerprint: 'invalid' }), /Unexpected filled Fast icon structure/);
});
