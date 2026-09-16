const asar = require('@electron/asar');
const { sha256 } = require('./archive.cjs');

// Reviewed 8690 and 8720 route chunks call a circular import before its var initializer.
const reviewed = new Set([
  'd5d6d194396ae24e97040fae3f7256216526279bd1a0a5117814e50ab870c7d8',
  '74fb751e6f77d9c326c66b3f0903ebbd4b31039d1655e8438b5188992cd4bb6e',
]);

function adaptStartup(source, allowed = reviewed) {
  if (!allowed.has(sha256(Buffer.from(source)))) return null;
  const { parse } = require('./adaptive.cjs');
  const ast = parse(source);
  const calls = ast.body.filter(node => node.type === 'ExpressionStatement');
  const exports = ast.body.filter(node => node.type === 'ExportNamedDeclaration').flatMap(node => node.specifiers);
  const routes = ['AppLayoutRoute', 'AuthedRoute'].map(name => exports.find(node => node.exported.name === name));
  const call = calls[0]?.expression;
  if (calls.length !== 1 || call.type !== 'CallExpression' || call.callee.type !== 'Identifier' || call.arguments.length || routes.some(node => !node)) {
    throw new Error('Unrecognized route initialization.');
  }
  const wrappers = routes.map(node => ({ node, name: `codexFast${node.exported.name}` }));
  const declarations = wrappers.map(({ node, name }) =>
    `function ${name}(...args){${call.callee.name}();return ${node.local.name}(...args)}`).join('');
  const edits = [{ node: calls[0], value: declarations },
    ...wrappers.map(({ node, name }) => ({ node: node.local, value: name }))];
  let patched = source;
  for (const { node, value } of edits.sort((a, b) => b.node.start - a.node.start)) {
    patched = patched.slice(0, node.start) + value + patched.slice(node.end);
  }
  parse(patched);
  return patched;
}

function planStartup(archive, files) {
  const targets = [];
  for (const entry of files.filter(file => /(?:^|[/\\])authed-route-[^/\\]+\.js$/.test(file))) {
    const info = asar.statFile(archive, entry);
    if (info.unpacked || info.link || info.size > 16384) continue;
    const bytes = asar.extractFile(archive, entry);
    const patched = adaptStartup(bytes.toString());
    if (patched !== null) targets.push({ entry, sourceSha256: sha256(bytes), patched: Buffer.from(patched), kinds: ['route-initialization'] });
  }
  return targets;
}

module.exports = { adaptStartup, planStartup };
