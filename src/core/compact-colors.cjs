const walk = require('acorn-walk');

const literal = node => node?.type === 'Literal' ? node.value :
  node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;
const identifier = node => node?.type === 'Identifier' ? node.name : undefined;
const isFunction = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);

function properties(node) {
  if (node?.type !== 'ObjectExpression') return null;
  const result = new Map();
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.computed || property.method || property.kind !== 'init') return null;
    const key = identifier(property.key) ?? literal(property.key);
    if (typeof key !== 'string' || result.has(key)) return null;
    result.set(key, property.value);
  }
  return result;
}

function jsxRuntime(node) {
  if (node?.type !== 'CallExpression' || node.optional || node.arguments.length < 2 || node.arguments.length > 3) return null;
  let callee = node.callee;
  if (callee.type === 'SequenceExpression') {
    if (callee.expressions.length !== 2 || literal(callee.expressions[0]) !== 0) return null;
    callee = callee.expressions[1];
  }
  if (callee.type !== 'MemberExpression' || callee.computed || callee.optional ||
      !identifier(callee.object) || !['jsx', 'jsxs'].includes(identifier(callee.property))) return null;
  return callee.object.name;
}

function jsx(node) {
  const runtime = jsxRuntime(node);
  if (!runtime) return null;
  const props = properties(node.arguments[1]);
  return props && { node, type: node.arguments[0], props, runtime };
}

function outputBinding(node, ancestors) {
  let index = ancestors.length - 2;
  let parent = ancestors[index];
  if (parent?.type === 'ConditionalExpression' && parent.alternate === node && literal(parent.consequent) === null) {
    node = parent;
    parent = ancestors[--index];
  }
  if (parent?.type === 'AssignmentExpression' && parent.operator === '=' && parent.right === node) return identifier(parent.left);
  if (parent?.type === 'VariableDeclarator' && parent.init === node) return identifier(parent.id);
  return undefined;
}

function hasClasses(node, required) {
  const value = literal(node);
  return typeof value === 'string' && required.every(token => value.split(/\s+/).includes(token));
}

function recognize(candidate) {
  const { shell, ancestors, navigation } = candidate;
  const binding = outputBinding(shell.node, ancestors);
  const children = navigation.props.get('children');
  const effortName = identifier(navigation.props.get('data-selected-reasoning-effort'));
  if (!binding || !effortName || children?.type !== 'ArrayExpression' ||
      children.elements.filter(child => identifier(child) === binding).length !== 1) return null;
  const row = jsx(shell.props.get('selectedValue'));
  if (!row || literal(row.type) !== 'span' || !hasClasses(row.props.get('className'), ['flex', 'min-w-0', 'items-center']) ||
      row.props.get('children')?.type !== 'ArrayExpression' || row.props.get('children').elements.length !== 2) return null;
  const [groupNode, effortNode] = row.props.get('children').elements;
  const group = jsx(groupNode), effort = jsx(effortNode);
  if (!group || literal(group.type) !== 'span' || !hasClasses(group.props.get('className'), ['flex', 'min-w-0', 'items-center']) ||
      group.props.get('children')?.type !== 'ArrayExpression' || !effort || !identifier(effort.type) ||
      literal(effort.props.get('collapse')) !== 'sm') return null;
  const models = group.props.get('children').elements.map(jsx).filter(child => child &&
    child.props.has('model') && child.props.has('stripGptPrefix') && child.props.has('serviceTierIconKind'));
  if (models.length !== 1 || !identifier(models[0].type) || !identifier(models[0].props.get('model')) ||
      [navigation, row, group, effort, models[0]].some(item => item.runtime !== shell.runtime)) return null;

  // The effort label, purple condition, and navigation metadata must describe the same selection.
  const label = effort.props.get('children');
  if (jsxRuntime(label) !== shell.runtime || !identifier(label.arguments[0])) return null;
  const labelObject = label.arguments[1];
  if (labelObject?.type !== 'ObjectExpression' || labelObject.properties.length !== 1 ||
      labelObject.properties[0].type !== 'SpreadElement') return null;
  const labelValue = labelObject.properties[0].argument;
  if (labelValue.type !== 'MemberExpression' || !labelValue.computed || labelValue.optional ||
      !identifier(labelValue.object) || identifier(labelValue.property) !== effortName) return null;
  const color = effort.props.get('className');
  if (color?.type !== 'ConditionalExpression' || literal(color.consequent) !== 'shrink-0 text-chart-purple' ||
      literal(color.alternate) !== 'shrink-0') return null;
  const test = color.test;
  let ultra = test;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    const lock = test.left.type === 'ChainExpression' ? test.left.expression : test.left;
    if (lock.type !== 'MemberExpression' || lock.computed || !identifier(lock.object) || identifier(lock.property) !== 'isModelLocked') return null;
    ultra = test.right;
  }
  if (ultra.type !== 'BinaryExpression' || ultra.operator !== '===' || identifier(ultra.left) !== effortName ||
      literal(ultra.right) !== 'ultra') return null;
  const style = group.props.get('style');
  if (style) {
    const existing = properties(style);
    if (!existing || existing.size !== 1 || literal(existing.get('color')) !== 'var(--color-text)') return null;
  }
  return { group, test, ultra, styled: !!style };
}

// This fallback deliberately recognizes only the legacy collapsed model/effort row.
// It keeps the native layout, labels, icon props, and menu behavior byte-for-byte.
function adaptCompactColors(source) {
  const { parse } = require('./adaptive.cjs');
  const scopes = new Map();
  walk.ancestor(parse(source), { CallExpression(node, ancestors) {
    const call = jsx(node);
    if (!call) return;
    const fn = ancestors.findLast(isFunction);
    if (!fn) return;
    if (!scopes.has(fn)) scopes.set(fn, []);
    scopes.get(fn).push({ call, ancestors: [...ancestors] });
  } });
  const candidates = [];
  for (const calls of scopes.values()) {
    const navigations = calls.filter(({ call }) => literal(call.props.get('data-composer-navigation-target')) === 'reasoning');
    if (!navigations.length) continue;
    const shells = calls.filter(({ call }) => call.props.has('selectedValue') &&
      ['categoryLabel', 'icon'].every(key => literal(call.props.get(key)) === null) &&
      ['collapse', 'indicator'].every(key => literal(call.props.get(key)) === 'none') &&
      literal(call.props.get('foreground')) === 'tertiary');
    if (!shells.length) continue;
    if (shells.length !== 1 || navigations.length !== 1) throw new Error('Cannot uniquely recognize compact model colors.');
    candidates.push({ shell: shells[0].call, ancestors: shells[0].ancestors, navigation: navigations[0].call });
  }
  if (candidates.length > 1) throw new Error('Cannot uniquely recognize compact model colors.');
  const match = candidates.length === 1 ? recognize(candidates[0]) : null;
  if (!match) return { patched: source, matched: false, changed: false };
  const edits = [];
  if (!match.styled) {
    const props = match.group.node.arguments[1];
    edits.push({ start: props.start + 1, end: props.start + 1, value: 'style:{color:"var(--color-text)"},' });
  }
  if (match.test !== match.ultra) edits.push({ start: match.test.start, end: match.test.end,
    value: source.slice(match.ultra.start, match.ultra.end) });
  let patched = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    patched = patched.slice(0, edit.start) + edit.value + patched.slice(edit.end);
  }
  parse(patched);
  return { patched, matched: true, changed: edits.length > 0 };
}

module.exports = { adaptCompactColors };
