// Fingerprint only the reviewed service-tier selector. Changes to unrelated
// request metadata or bundled imports must not invalidate this auth edit.
const original = 'bf7cd7ba0318341b2fda688a3e1a84b3452dd6ae58aab8f515df997906a36453';
const patched = 'f2c596b6ec39138cfc62f3af609697d605a1fa3028829929e0f206a172824b2a';
const member = (node, name) => node?.type === 'MemberExpression' && !node.computed && node.property.name === name;
const property = (node, name) => {
  const matches = node?.properties?.filter(p => p.type === 'Property' && !p.computed && (p.key.name || p.key.value) === name);
  return matches?.length === 1 ? matches[0].value : null;
};
const same = (node, name) => node?.type === 'Identifier' && node.name === name;
const literal = node => node?.type === 'Literal' ? node.value :
  node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;

function recognize(fn, recipe, { shape, nodePath }) {
  if (fn.params.length !== 5 || fn.params[0].type !== 'Identifier' || fn.params[2].type !== 'Identifier' ||
      fn.body.body.length !== 1 || fn.body.body[0].type !== 'ReturnStatement') return null;
  const prepare = fn.body.body[0].argument;
  if (prepare?.type !== 'ArrowFunctionExpression' || !prepare.async || prepare.params.length !== 2 ||
      prepare.params.some(p => p.type !== 'Identifier') || prepare.body.type !== 'BlockStatement') return null;
  const declarations = prepare.body.body.filter(s => s.type === 'VariableDeclaration').flatMap(s => s.declarations);
  const binding = name => {
    const found = declarations.filter(d => same(d.id, name));
    return found.length === 1 ? found[0].init : null;
  };
  const selectors = [];
  for (const declaration of declarations) {
    const all = declaration.init?.type === 'AwaitExpression' ? declaration.init.argument : null;
    if (declaration.id.type !== 'ArrayPattern' || declaration.id.elements[0]?.type !== 'Identifier' ||
        all?.type !== 'CallExpression' || !member(all.callee, 'all') || !same(all.callee.object, 'Promise') ||
        all.arguments.length !== 1 || all.arguments[0].type !== 'ArrayExpression') continue;
    const call = all.arguments[0].elements[0];
    if (call?.type !== 'CallExpression' || call.arguments.length || call.callee.type !== 'ArrowFunctionExpression' ||
        shape(call.callee).fingerprint !== original) continue;
    const selector = call.callee, statements = selector.body.body;
    const options = statements[0].test.left.name;
    const saved = statements[0].consequent.argument;
    const account = statements[2].declarations[0].init.argument;
    const optionInput = binding(options);
    const conversation = saved.arguments[0].left.expression.object.name;
    const conversationInput = binding(conversation);
    if (!same(account.callee.object, fn.params[0].name) || !same(saved.callee, fn.params[2].name) ||
        !member(optionInput, 'submissionOptions') || !same(optionInput.object, prepare.params[1].name) ||
        conversationInput?.type !== 'CallExpression' || !member(conversationInput.callee, 'getConversation') ||
        !same(conversationInput.callee.object, fn.params[0].name) || conversationInput.arguments.length !== 1 ||
        !same(conversationInput.arguments[0], prepare.params[0].name)) continue;
    const result = prepare.body.body.at(-1);
    const submission = result?.type === 'ReturnStatement' ? property(result.argument, 'submission') : null;
    if (literal(property(result?.argument, 'status')) !== 'ready' || submission?.type !== 'ObjectExpression') continue;
    const resume = property(submission, 'resume'), start = property(submission, 'start'), steer = property(submission, 'steer');
    if (resume?.type !== 'Identifier' || start?.type !== 'Identifier') continue;
    const resumeInput = binding(resume.name), request = property(binding(start.name), 'request');
    const tier = declaration.id.elements[0].name;
    if (![resumeInput, request, steer].every(object => same(property(object, 'serviceTier'), tier)) ||
        !same(property(resumeInput, 'conversationId'), prepare.params[0].name) ||
        !same(property(request, 'threadId'), prepare.params[0].name)) continue;
    selectors.push({ ...recipe, anyScope: false, scopes: ['webview', 'main'], allowValues: ['apiKey'],
      fingerprint: original, patchedFingerprint: patched, fingerprintPath: nodePath(fn, selector),
      allowsSingleScope: Boolean(recipe.anyScope && [recipe, ...(recipe.compatibleFingerprints || [])]
        .some(candidate => candidate.fingerprint === shape(fn).fingerprint)),
      path: nodePath(fn, statements[3].argument.test), validation: 'submission-service-tier', skipValidation: false, environment: [] });
  }
  if (selectors.length > 1) throw new Error('Cannot uniquely recognize the request service-tier selector.');
  return selectors[0] || null;
}

async function validate(match, { parse, at }) {
  const vm = require('node:vm');
  const selector = at(parse(match.patchedFunction).body[0], match.recipe.fingerprintPath);
  const statements = selector.body.body;
  const options = statements[0].test.left.name;
  const savedCall = statements[0].consequent.argument;
  const saved = savedCall.callee.name, conversation = savedCall.arguments[0].left.expression.object.name;
  const client = statements[2].declarations[0].init.argument.callee.object.name;
  const source = match.patchedFunction.slice(selector.start, selector.end);
  const results = [];
  for (const auth of ['apiKey', 'chatgpt', 'other', null]) for (const tier of ['priority', null, undefined]) {
    let queried = false;
    const context = { [options]: { serviceTier: tier }, [conversation]: { latestModel: 'configured-model' },
      [saved]: async () => { throw new Error('Unexpected saved-speed lookup.'); },
      [client]: { getAccount: async () => { queried = true; return { account: auth == null ? null : { type: auth } }; } } };
    const result = await vm.runInNewContext(`(${source})()`, context, { timeout: 1000 });
    const expected = tier != null && ['apiKey', 'chatgpt'].includes(auth) ? tier : null;
    if (result !== expected || queried !== (tier != null)) throw new Error('Request service-tier verification failed.');
    results.push({ kind: 'request', scope: match.scope, auth, tier: tier ?? null, passed: true });
  }
  for (const tier of ['priority', null]) {
    const result = await vm.runInNewContext(`(${source})()`, {
      [options]: null, [conversation]: { latestModel: 'configured-model' },
      [saved]: async model => { if (model !== 'configured-model') throw new Error('Saved model changed.'); return tier; },
      [client]: { getAccount: async () => { throw new Error('Saved-speed policy must remain authoritative.'); } },
    }, { timeout: 1000 });
    if (result !== tier) throw new Error('Saved service-tier delegation changed.');
    results.push({ kind: 'request', scope: match.scope, saved: true, tier, passed: true });
  }
  return results;
}

module.exports = { recognize, validate };
