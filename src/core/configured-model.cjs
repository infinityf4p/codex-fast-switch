// Native queries already support explicitly selected hidden models. Include
// the configured API-key model in that same set so settings and the composer
// see consistent speed metadata. This does not synthesize model list entries.
function includeConfigured(additional, authMethod, config) {
  const models = new Set(additional);
  if (authMethod === 'apikey' && typeof config?.model === 'string') models.add(config.model);
  return models;
}

function inject(source, fn) {
  const auth = fn.params[0]?.properties?.find(p => p.key.name === 'authMethod')?.value;
  const additions = [], configs = new Set();
  require('acorn-walk').simple(fn, {
    Property(node) {
      if (node.key.name === 'additionalAvailableModels' && node.value.type === 'NewExpression' &&
          node.value.callee.name === 'Set' && node.value.arguments.length === 1) additions.push(node.value);
    },
    MemberExpression(node) {
      if (node.property.name === 'model_catalog_json' && node.object.type === 'Identifier') configs.add(node.object.name);
    },
  });
  if (auth?.type !== 'Identifier' || additions.length !== 1 || configs.size !== 1) throw new Error('Unknown configured model query.');
  const set = additions[0], argument = set.arguments[0];
  return source.slice(fn.start, set.start) + `(${includeConfigured.toString()})(${source.slice(argument.start, argument.end)},` +
    `${auth.name},${[...configs][0]})` + source.slice(set.end, fn.end);
}

module.exports = { includeConfigured, inject };
