const walk = require('acorn-walk');

const member = (node, key) => node?.type === 'MemberExpression' && !node.computed && node.property.name === key;
const own = (node, key) => member(node, key) && node.object.type === 'ThisExpression';
function some(root, type, predicate) {
  let found = false;
  walk.simple(root, { [type](node) { if (predicate(node)) found = true; } });
  return found;
}

function supportsContract(body) {
  const definitions = body.body.filter(node => node.type === 'MethodDefinition' && !node.computed);
  const names = ['initializeWindowsUpdater', 'setUpdateReady', 'setUpdateLifecycleState',
    'getIsUpdateReady', 'checkForUpdates', 'installUpdatesIfAvailable'];
  if (names.some(name => definitions.filter(node => node.key.name === name).length !== 1)) return false;
  if (definitions.some(node => names.includes(node.key.name) && (node.static || node.kind !== 'method'))) return false;
  const methods = Object.fromEntries(definitions.map(node => [node.key.name, node.value]));
  const ready = methods.setUpdateReady.params[0], lifecycle = methods.setUpdateLifecycleState.params[0];
  if (ready?.type !== 'Identifier' || lifecycle?.type !== 'Identifier' ||
      methods.setUpdateReady.params.length !== 1 || methods.setUpdateLifecycleState.params.length !== 1) return false;

  const storesValue = (fn, parameter) => some(fn, 'AssignmentExpression', node => node.operator === '=' &&
    node.left.type === 'MemberExpression' && node.left.object.type === 'ThisExpression' &&
    node.right.type === 'Identifier' && node.right.name === parameter.name);
  const notifies = (fn, callback, parameter) => some(fn, 'CallExpression', node => member(node.callee, callback) &&
    own(node.callee.object, 'options') && node.arguments.length === 1 &&
    node.arguments[0].type === 'Identifier' && node.arguments[0].name === parameter.name);
  if (!storesValue(methods.setUpdateReady, ready) || !storesValue(methods.setUpdateLifecycleState, lifecycle) ||
      !notifies(methods.setUpdateReady, 'onUpdateReadyChanged', ready) ||
      !notifies(methods.setUpdateLifecycleState, 'onUpdateLifecycleStateChanged', lifecycle)) return false;
  const returned = methods.getIsUpdateReady.body.body;
  if (returned.length !== 1 || returned[0].type !== 'ReturnStatement' ||
      returned[0].argument?.type !== 'MemberExpression' || returned[0].argument.object.type !== 'ThisExpression') return false;
  const readyField = returned[0].argument;
  if (!some(methods.setUpdateReady, 'AssignmentExpression', node => node.operator === '=' &&
    own(node.left, readyField.property.name) && node.right.type === 'Identifier' && node.right.name === ready.name)) return false;

  for (const name of ['checkForUpdates', 'installUpdatesIfAvailable']) {
    if (methods[name].params.length || !some(methods[name], 'CallExpression', node => member(node.callee, name) &&
      own(node.callee.object, 'updater') && node.arguments.length === 0)) return false;
  }
  const initializer = methods.initializeWindowsUpdater;
  if (!initializer.async || initializer.params.length !== 0) return false;
  for (const [callback, setter] of [['onUpdateReadyChanged', 'setUpdateReady'],
    ['onUpdateLifecycleStateChanged', 'setUpdateLifecycleState']]) {
    if (!some(initializer, 'Property', node => !node.computed && (node.key.name || node.key.value) === callback &&
      node.value.params?.length === 1 && node.value.params[0].type === 'Identifier' &&
      some(node.value, 'CallExpression', call => own(call.callee, setter) && call.arguments.length === 1 &&
        call.arguments[0].type === 'Identifier' && call.arguments[0].name === node.value.params[0].name))) return false;
  }
  const bindings = [];
  walk.simple(initializer, { AssignmentExpression(node) {
    if (node.operator === '=' && own(node.left, 'updater') && node.right.type === 'Identifier') bindings.push(node.right.name);
  } });
  if (new Set(bindings).size !== 1) return false;
  return ['initialize', 'hasUpdater', 'getIsUpdateReady'].every(name => some(initializer, 'CallExpression', node =>
    member(node.callee, name) && node.callee.object.type === 'Identifier' &&
    node.callee.object.name === bindings[0] && node.arguments.length === 0));
}

module.exports = { supportsContract };
