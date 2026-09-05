const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parse, shape } = require('../../src/core/adaptive.cjs');
const { adaptCompact } = require('../../src/core/compact.cjs');

const legacy = `function legacy(input) {
  const hide = input.hideLabel;
  const model = (0, R.jsx)(Model, { model: input.model, stripGptPrefix: !0, serviceTierIconKind: input.iconKind });
  const group = (0, R.jsx)('span', { className: 'flex min-w-0 items-center gap-1', children: [input.extra, model] });
  const effort = (0, R.jsx)(Effort, { effort: input.effort, collapse: 'sm', className: input.locked && input.effort === 'ultra' ? 'shrink-0 text-chart-purple' : 'shrink-0' });
  const row = (0, R.jsx)('span', { className: 'flex max-w-40 min-w-0 items-center gap-1.5', children: [group, effort] });
  return (0, R.jsx)('button', { children: [hide ? null : row] });
}`;
const modern = `function modern(input) {
  const model = (0, Q.jsx)(Model, { model: input.model, stripGptPrefix: !0, className: styles.model });
  const glyph = (0, Q.jsx)(Bolt, { className: styles.icon, iconKind: input.iconKind });
  const group = (0, Q.jsx)('span', { className: styles.label, children: [glyph, model] });
  const chevron = (0, Q.jsx)(Chevron, { 'aria-hidden': true, className: 'native-chevron' });
  return (0, Q.jsx)('button', { children: [group, chevron] });
}`;
const expectedLegacy = `function legacy(input) {
  const hide = input.hideLabel;
  const model = (0, R.jsx)(Model, { model: input.model, stripGptPrefix: !1, serviceTierIconKind: null });
  const group = (0, R.jsx)('span', { className: 'flex min-w-0 items-center gap-1' + ' ' + styles.model + ' ' + styles.label, children: [input.extra, (0, R.jsx)(Bolt, { className: styles.icon, iconKind: input.iconKind }), model] });
  const effort = (0, R.jsx)(Effort, { effort: input.effort, collapse: 'none', className: input.effort === 'ultra' ? 'shrink-0 text-chart-purple' : 'shrink-0' });
  const row = (0, R.jsx)('span', { className: 'flex max-w-40 min-w-0 items-center gap-1', children: [group, effort] });
  return (0, R.jsx)('button', { children: [hide ? null : row, hide ? null : (0, R.jsx)(Chevron, { 'aria-hidden': true, className: 'native-chevron' })] });
}`;
const expectedModern = modern.replace('stripGptPrefix: !0', 'stripGptPrefix: !1');
const property = (statement, index) => ['body', 'body', statement, 'declarations', 0, 'init', 'arguments', 1, 'properties', index, 'value'];
const recipe = {
  legacy: {
    fingerprint: shape(parse(legacy).body[0]).fingerprint,
    patchedFingerprint: shape(parse(expectedLegacy).body[0]).fingerprint,
    paths: {
      prefix: property(1, 1), gap: property(4, 0), modelClass: property(2, 0),
      serviceTier: property(1, 2), glyphBefore: [...property(2, 1), 'elements', 1],
      effortCollapse: property(3, 1), effortClass: property(3, 2),
      children: ['body', 'body', 5, 'argument', 'arguments', 1, 'properties', 0, 'value'],
      hideLabel: ['body', 'body', 0, 'declarations', 0, 'id'],
      runtime: ['body', 'body', 5, 'argument', 'callee', 'expressions', 1, 'object'],
    },
  },
  modern: {
    fingerprint: shape(parse(modern).body[0]).fingerprint,
    patchedFingerprint: shape(parse(expectedModern).body[0]).fingerprint,
    paths: { prefix: property(0, 1), modelClass: property(0, 2), parentClass: property(2, 0), icon: ['body', 'body', 1, 'declarations', 0, 'init'], iconKind: property(1, 1), chevron: ['body', 'body', 3, 'declarations', 0, 'init'] },
  },
};
const source = `${legacy}\n${modern}`;

test('compact rendering retains dynamic choices and matches the native visual fields', () => {
  const result = adaptCompact(source, recipe);
  assert.equal(result.matched, true);
  assert.equal(result.changed, true);
  const runtime = { jsx: (type, props) => typeof type === 'function' ? type(props) : ({ type, props }) };
  const context = vm.createContext({ R: runtime, Q: runtime, Model: 'model', Effort: 'effort', Bolt: props => props.iconKind == null ? null : ({ type: 'svg', props }), Chevron: 'svg', styles: { model: 'model-foreground', label: 'native-label', icon: 'native-inline-icon' } });
  vm.runInContext(result.patched, context);
  for (const effort of ['low', 'high', 'ultra']) for (const iconKind of [null, 'fast', 'ultrafast']) {
    context.input = { model: `GPT-${effort}`, effort, iconKind, extra: 'existing-indicator', locked: false, hideLabel: false };
    const button = vm.runInContext('legacy(input)', context);
    const [row, chevron] = button.props.children;
    const [group, effortLabel] = row.props.children;
    const [existing, glyph, model] = group.props.children;
    assert.equal(model.props.model, context.input.model);
    assert.equal(model.props.stripGptPrefix, false);
    assert.match(group.props.className, /model-foreground native-label/);
    assert.equal(existing, context.input.extra);
    assert.equal(model.props.serviceTierIconKind, null);
    assert.equal(glyph === null, iconKind === null);
    if (glyph) {
      assert.equal(glyph.props.className, 'native-inline-icon');
      assert.equal(glyph.props.iconKind, iconKind);
    }
    assert.equal(row.props.className.split(' ').at(-1), 'gap-1');
    assert.equal(effortLabel.props.effort, effort);
    assert.equal(effortLabel.props.collapse, 'none');
    assert.equal(effortLabel.props.className.includes('text-chart-purple'), effort === 'ultra');
    assert.equal(chevron.type, 'svg');
    assert.equal(chevron.props.className, 'native-chevron');
    assert.equal(chevron.props['aria-hidden'], true);
    const newModel = vm.runInContext('modern(input)', context).props.children[0].props.children[1];
    assert.equal(newModel.props.model, context.input.model);
    assert.equal(newModel.props.stripGptPrefix, false);
  }
  context.input = { model: 'GPT-hidden', effort: 'ultra', hideLabel: true };
  assert.equal(vm.runInContext('legacy(input)', context).props.children.every(child => child === null), true);
});

test('compact adaptation is idempotent and accepts identifier and formatting changes', () => {
  const renamed = source.replaceAll('input', 'options').replaceAll('R.jsx', 'Runtime.jsx');
  const first = adaptCompact(renamed, recipe);
  assert.equal(first.changed, true);
  assert.deepEqual(adaptCompact(first.patched, recipe), { patched: first.patched, matched: true, changed: false });
  assert.equal(adaptCompact(`${expectedLegacy}\n${modern}`, recipe).changed, true);
  assert.equal(adaptCompact(`${legacy}\n${expectedModern}`, recipe).changed, true);
});

test('compact adaptation rejects missing, ambiguous, or changed known layouts', () => {
  assert.throws(() => adaptCompact(legacy, recipe), /both compact/);
  assert.throws(() => adaptCompact(`${source}\n${legacy.replace('function legacy', 'function duplicate')}`, recipe), /both compact/);
  assert.throws(() => adaptCompact(source.replace("collapse: 'sm'", "collapse: 'lg'"), recipe), /both compact/);
  assert.deepEqual(adaptCompact('function unrelated() { return 1; }', recipe), { patched: 'function unrelated() { return 1; }', matched: false, changed: false });
  const wrongOutput = structuredClone(recipe);
  wrongOutput.legacy.patchedFingerprint = 'unrecognized';
  assert.throws(() => adaptCompact(source, wrongOutput), /Unexpected transformed legacy/);
});
