const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { adaptCompactColors } = require('../../src/core/compact-colors.cjs');

// Small rendering fixture, not a copy of the application's implementation.
const source = `function compact(input) {
  const { model, effort, tier, locked, hideLabel } = input;
  const policy = { isModelLocked: locked };
  const value = hideLabel ? null : (0, R.jsx)(Value, {
    categoryLabel: null, collapse: 'none', icon: null, indicator: 'none',
    selectedValue: (0, R.jsxs)('span', {
      className: 'flex max-w-40 min-w-0 items-center gap-1.5',
      children: [(0, R.jsxs)('span', {
        className: 'flex min-w-0 items-center gap-1',
        children: [input.indicator, (0, R.jsx)(Model, {
          model, displayName: input.displayName, serviceTierIconKind: tier, stripGptPrefix: !1
        })]
      }), (0, R.jsx)(Effort, {
        collapse: 'sm', className: policy?.isModelLocked && effort === 'ultra' ? 'shrink-0 text-chart-purple' : 'shrink-0',
        children: (0, R.jsx)(Label, { ...labels[effort] })
      })]
    }), selectedValueClassName: 'max-w-40', foreground: 'tertiary'
  });
  return (0, R.jsxs)('button', {
    'data-composer-navigation-target': 'reasoning', 'data-selected-reasoning-effort': effort,
    onClick: input.onClick, children: [input.leading, value]
  });
}`;

function render(code, input) {
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ R: { jsx, jsxs: jsx }, Model: 'model', Effort: 'effort', Value: 'value',
    Label: 'label', labels: Object.fromEntries(['minimal', 'low', 'medium', 'high', 'xhigh', 'ultra'].map(effort => [effort, { id: effort }])), input });
  vm.runInContext(code, context);
  return vm.runInContext('compact(input)', context);
}

test('compact colors use the theme text color and purple only for Ultra without changing selection or layout', () => {
  const result = adaptCompactColors(source);
  assert.equal(result.matched, true);
  assert.equal(result.changed, true);
  for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh', 'ultra']) {
    for (const locked of [true, false]) for (const tier of [null, 'fast', 'ultrafast']) {
      const input = { model: 'gpt6-astra', displayName: 'GPT-6 Astra', effort, locked, tier,
        onClick() {}, indicator: 'daybreak', leading: 'unchanged-leading' };
      const before = render(source, input), after = render(result.patched, input);
      const row = after.props.children[1].props.selectedValue;
      const [group, effortLabel] = row.props.children;
      assert.equal(group.props.style.color, 'var(--color-text)');
      assert.equal(effortLabel.props.className.includes('text-chart-purple'), effort === 'ultra');
      assert.equal(effortLabel.props.children.props.id, effort);
      assert.equal(effortLabel.props.collapse, 'sm');
      assert.equal(group.props.children[1].props.model, input.model);
      assert.equal(group.props.children[1].props.displayName, input.displayName);
      assert.equal(group.props.children[1].props.serviceTierIconKind, tier);
      assert.equal(group.props.children[1].props.stripGptPrefix, false);
      assert.equal(after.props['data-selected-reasoning-effort'], effort);
      assert.equal(after.props.onClick, input.onClick);
      // Reversing the two intended color changes reproduces the complete original render tree.
      delete group.props.style;
      effortLabel.props.className = before.props.children[1].props.selectedValue.props.children[1].props.className;
      assert.equal(JSON.stringify(after), JSON.stringify(before));
    }
  }
  assert.equal(render(result.patched, { hideLabel: true }).props.children[1], null);
});

test('compact colors are idempotent and tolerate renamed bindings, quotes, and unrelated functions', () => {
  const renamed = source.replaceAll('policy', 'selectionPolicy').replaceAll('effort', 'power')
    .replaceAll('data-selected-reasoning-power', 'data-selected-reasoning-effort')
    .replaceAll('R.', 'Runtime.').replaceAll("'ultra'", '`ultra`');
  const first = adaptCompactColors(`${renamed}\nfunction unrelated() { return 'unchanged'; }`);
  assert.equal(first.changed, true);
  assert.deepEqual(adaptCompactColors(first.patched), { patched: first.patched, matched: true, changed: false });
  const onlyPurple = source.replace('policy?.isModelLocked && ', '');
  assert.equal(adaptCompactColors(onlyPurple).changed, true);
  const onlyText = source.replace("className: 'flex min-w-0 items-center gap-1',", "style: { color: 'var(--color-text)' }, className: 'flex min-w-0 items-center gap-1',");
  assert.equal(adaptCompactColors(onlyText).changed, true);
});

test('compact colors preserve memo dependencies when rendered through an assignment and cache', () => {
  const cached = source.replace('  const value = hideLabel', '  let value; if (cache.effort !== effort || cache.input !== input) { value = hideLabel')
    .replace("  return (0, R.jsxs)('button'", "  cache.value = value; cache.effort = effort; cache.input = input; } else value = cache.value;\n  return (0, R.jsxs)('button'");
  const result = adaptCompactColors(cached);
  assert.equal(result.changed, true);
  assert.match(result.patched, /cache\.effort !== effort \|\| cache\.input !== input/);
  assert.match(result.patched, /cache\.value = value; cache\.effort = effort; cache\.input = input/);
  assert.equal(adaptCompactColors(result.patched).changed, false);
  const jsx = (type, props) => ({ type, props });
  const input = { model: 'gpt6-astra', effort: 'low', tier: 'fast', locked: false };
  const context = vm.createContext({ R: { jsx, jsxs: jsx }, Model: 'model', Effort: 'effort', Value: 'value',
    Label: 'label', labels: { low: { id: 'low' }, ultra: { id: 'ultra' } }, input, cache: {} });
  vm.runInContext(result.patched, context);
  const row = () => vm.runInContext('compact(input)', context).props.children[1].props.selectedValue;
  assert.equal(row().props.children[1].props.className, 'shrink-0');
  input.effort = 'ultra';
  const ultra = row();
  assert.equal(ultra.props.children[1].props.className, 'shrink-0 text-chart-purple');
  assert.equal(ultra.props.children[0].props.style.color, 'var(--color-text)');
  assert.equal(row(), ultra);
  input.effort = 'low';
  assert.equal(row().props.children[1].props.className, 'shrink-0');
});

test('compact colors reject duplicate targets and preserve unknown or partly recognized layouts', () => {
  assert.throws(() => adaptCompactColors(`${source}\n${source.replace('function compact', 'function duplicate')}`), /uniquely/);
  const unknown = [
    'function unrelated() { return 1; }',
    source.replace("'reasoning'", "'permissions'"),
    source.replace("'data-selected-reasoning-effort': effort", "'data-selected-reasoning-effort': other"),
    source.replace('...labels[effort]', '...labels[other]'),
    source.replace('(0, R.jsx)(Label', 'unknown(Label'),
    source.replace("collapse: 'sm'", "collapse: 'large'"),
    source.replace('policy?.isModelLocked', 'policy?.isAdmin'),
    source.replace("effort === 'ultra'", "effort !== 'ultra'"),
    source.replace('children: [input.leading, value]', 'children: [input.leading, another]'),
    source.replace("className: 'flex min-w-0 items-center gap-1',", "style: { color: 'red' }, className: 'flex min-w-0 items-center gap-1',"),
    source.replace("className: 'flex min-w-0 items-center gap-1',", "style: { color: 'var(--color-text)', opacity: 0.5 }, className: 'flex min-w-0 items-center gap-1',"),
    source.replace("className: 'flex min-w-0 items-center gap-1',", "...input.props, className: 'flex min-w-0 items-center gap-1',"),
    source.replace('serviceTierIconKind: tier', 'serviceTierIconKind: tier, serviceTierIconKind: other'),
  ];
  for (const input of unknown) assert.deepEqual(adaptCompactColors(input), { patched: input, matched: false, changed: false });
});
