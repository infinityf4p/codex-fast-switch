const adaptive = require('../../src/core/adaptive.cjs');
const walk = require('acorn-walk');

// Independent fixtures written for this project; no vendor implementation is embedded.
const snippets = [
  'function ui(options){const auth=readAuth();const data=readRequirements();const allowed=auth.authMethod==="chatgpt";return {isServiceTierAllowed:!auth.isLoading&&allowed&&data.data.requirements.featureRequirements.fast_mode!==false};}',
  'async function request(client,host){const auth=await readAuth();if(auth!=="chatgpt")return false;const data=await readRequirements();return data.requirements.featureRequirements.fast_mode!==false;}',
  'function models(host,current){const serviceTierForRequest=null;return getModels(host);}',
];
const kinds = ['ui', 'request', 'models'];
const recipes = snippets.map((source, index) => {
  const kind = kinds[index];
  const fn = adaptive.parse(source).body[0];
  let target;
  walk.simple(fn, {
    BinaryExpression(node) { if (node.right.type === 'Literal' && node.right.value === 'chatgpt') target = node; },
    CallExpression(node) { if (kind === 'models' && node.callee.name === 'getModels') target = node.arguments[0]; },
  });
  const shaped = adaptive.shape(fn);
  const value = adaptive.replacement(source, fn, target, kind);
  const patched = source.slice(0, target.start) + value + source.slice(target.end);
  const stubs = kind === 'ui' ? [['readAuth', 'auth'], ['readRequirements', 'query']] :
    kind === 'request' ? [['readAuth', 'readAuth'], ['readRequirements', 'readRequirements']] : [];
  return { kind, fingerprint: shaped.fingerprint, patchedFingerprint: adaptive.shape(adaptive.parse(patched).body[0]).fingerprint,
    path: adaptive.nodePath(fn, target), environment: stubs.map(([name, stub]) => ({ index: shaped.names.indexOf(name), stub })) };
});
module.exports = { snippets, recipes };
