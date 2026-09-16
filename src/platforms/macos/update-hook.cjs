const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const walk = require('acorn-walk');
const { parse } = require('../../core/adaptive.cjs');
const { sha256 } = require('../../core/archive.cjs');
const { saveJson } = require('../../core/state.cjs');

const LIBRARY = 'codex-fast-update-hook.dylib';
const CONFIG = 'codex-fast-switch-update.json';
const literal = node => node?.type === 'Literal' ? node.value :
  node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;

function adapt(source) {
  const matches = [];
  walk.simple(parse(source), { MethodDefinition(method) {
    if (method.computed || method.key.name !== 'initializeMacSparkle' || !method.value.async) return;
    walk.ancestor(method.value.body, { CallExpression(call, ancestors) {
      if (ancestors.some(node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))) return;
      if (call.callee.type !== 'Identifier' || call.arguments.length !== 1) return;
      const join = call.arguments[0];
      if (join.type !== 'CallExpression' || join.arguments.length !== 3) return;
      const [resources, native, addon] = join.arguments;
      if (resources.type !== 'MemberExpression' || resources.computed || resources.object.name !== 'process' ||
          resources.property.name !== 'resourcesPath' || literal(native) !== 'native' || literal(addon) !== 'sparkle.node') return;
      const callee = join.callee.type === 'SequenceExpression' ? join.callee.expressions.at(-1) : join.callee;
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'join') matches.push(call);
    } });
  } });
  if (matches.length !== 1 || source.includes(LIBRARY)) throw new Error('Cannot uniquely recognize the macOS update initialization.');
  const target = matches[0];
  const replacement = `await(async function(addon){try{const{NobjcLibrary}=await import("objc-js");` +
    `const hook=new NobjcLibrary(process.resourcesPath+"/${LIBRARY}");` +
    `hook.CodexFastSwitchUpdateHook.installWithConfigurationAtPath$(hook.NSString.stringWithUTF8String$(process.resourcesPath+"/${CONFIG}"));` +
    `}catch(error){console.warn("Codex Fast Switch update hook unavailable",String(error))}return addon})` +
    `(${source.slice(target.start, target.end)})`;
  parse(`async function check(){return ${replacement}}`);
  return source.slice(0, target.start) + replacement + source.slice(target.end);
}

function plan(archive) {
  const targets = [];
  asar.uncacheAll();
  for (const file of asar.listPackage(archive)) {
    const entry = file.replaceAll('\\', '/').replace(/^\//, '');
    if (!entry.startsWith('.vite/build/') || !entry.endsWith('.js')) continue;
    const info = asar.statFile(archive, entry);
    if (info.unpacked || info.link || info.size > 32 * 1024 * 1024) continue;
    const bytes = asar.extractFile(archive, entry);
    const source = bytes.toString('utf8');
    if (!source.includes('initializeMacSparkle') || !source.includes('sparkle.node')) continue;
    targets.push({ entry, sourceSha256: sha256(bytes), patched: Buffer.from(adapt(source)), kinds: ['update-relaunch'] });
  }
  if (targets.length !== 1) throw new Error('Cannot uniquely recognize the macOS updater. The official app will be kept unchanged.');
  const bridge = JSON.parse(asar.extractFile(archive, 'node_modules/objc-js/package.json'));
  if (bridge.name !== 'objc-js') throw new Error('The macOS update bridge is unavailable. The official app will be kept unchanged.');
  return targets[0];
}

function copyResources(destination, app, state) {
  const resources = path.join(destination, 'Contents/Resources');
  fs.copyFileSync(path.join(__dirname, '../../../build/macos', LIBRARY), path.join(resources, LIBRARY));
  saveJson(path.join(resources, CONFIG), { schema: 1, app: path.resolve(app), state: path.resolve(state) });
}

module.exports = { LIBRARY, CONFIG, adapt, plan, copyResources };
