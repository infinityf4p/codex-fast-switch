const asar = require('@electron/asar');
const walk = require('acorn-walk');
const vm = require('node:vm');
const { sha256 } = require('./archive.cjs');
const defaultRecipes = require('./rspack-recipes.json');

const literal = node => node?.type === 'Literal' ? node.value : undefined;
const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const readFunction = source => require('./adaptive.cjs').parse(`(${source})`).body[0].expression;

// Rspack repeats a module in several lazy chunks. Validate every copy of a
// reviewed module instead of treating those copies as independent UI gates.
function modules(source) {
  const { parse } = require('./adaptive.cjs');
  const tables = [];
  const ast = parse(source);
  for (const statement of ast.body) {
    if (statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'VariableDeclaration') {
      for (const d of statement.declaration.declarations) {
        if (d.id.name === '__webpack_modules__' && d.init?.type === 'ObjectExpression') tables.push(d.init);
      }
    }
    if (statement.type !== 'ExpressionStatement') continue;
    const expressions = statement.expression.type === 'SequenceExpression' ? statement.expression.expressions : [statement.expression];
    for (const e of expressions) {
      if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression' &&
          !e.left.computed && e.left.object.name === 'exports' && e.left.property.name === 'modules' &&
          e.right.type === 'ObjectExpression') tables.push(e.right);
    }
  }
  const found = new Map();
  for (const table of tables) for (const p of table.properties) {
    if (p.type !== 'Property' || p.computed || !functionTypes.has(p.value.type)) throw new Error('Unsupported Rspack module table.');
    const id = String(p.key.name ?? literal(p.key));
    if (found.has(id)) throw new Error(`Duplicate Rspack module: ${id}`);
    found.set(id, p.value);
  }
  return found;
}

function transform(source, fn, recipe, donor) {
  const { at, replacement, adaptFastIcon, shape } = require('./adaptive.cjs');
  let result = source.slice(fn.start, fn.end);
  if (recipe.native) return result;
  if (recipe.kind === 'api-ultrafast-backend') {
    result = require('./backend-speed.cjs').inject(source, fn);
  } else if (recipe.kind === 'api-configured-model') {
    result = require('./configured-model.cjs').inject(source, fn);
  } else if (recipe.kind === 'fast-icon') {
    const input = `const target=${result};const donor=${donor};`;
    const patched = adaptFastIcon(input).patched;
    result = patched.slice('const target='.length, patched.indexOf(';const donor='));
  } else {
    const target = at(fn, recipe.path);
    let start = target.start, end = target.end, value;
    if (recipe.kind === 'model-name') {
      if (target.type !== 'ConditionalExpression' || target.alternate.type !== 'Identifier') throw new Error('Unknown model label.');
      value = source.slice(target.alternate.start, target.alternate.end);
    } else if (recipe.kind === 'default-model-presets') {
      if (target.type !== 'Identifier') throw new Error('Unknown model presets.');
      start = end = fn.body.start + 1;
      value = `${target.name}??=${JSON.stringify({ presets: require('./picker-recipe.json')[1].presets })};`;
    } else {
      value = replacement(source, fn, target, recipe.kind, null, undefined, recipe);
    }
    result = source.slice(fn.start, start) + value + source.slice(end, fn.end);
  }
  if (shape(readFunction(result)).fingerprint !== recipe.patchedFingerprint) throw new Error(`Unexpected Rspack ${recipe.kind} transform.`);
  return result;
}

function collect(entries, recipes = defaultRecipes) {
  const { shape } = require('./adaptive.cjs');
  const matches = [];
  for (const entry of entries) {
    const scoped = recipes.filter(r => r.scope === entry.scope);
    const variants = recipe => [recipe, ...(recipe.compatibleVariants || []).map(variant => ({ ...recipe, ...variant }))];
    if (!scoped.some(r => variants(r).some(v => entry.source.includes(v.module)))) continue;
    const table = modules(entry.source);
    for (const recipe of scoped) {
      const known = variants(recipe);
      for (const id of new Set(known.map(v => v.module))) {
        const factory = table.get(id);
        if (!factory) continue;
        const found = [];
        walk.full(factory, fn => {
          if (!functionTypes.has(fn.type) || fn.end - fn.start > 16000) return;
          const variant = known.find(v => v.module === id && shape(fn).fingerprint === v.fingerprint);
          if (variant) found.push({ fn, recipe: variant });
        });
        if (found.length !== 1) throw new Error(`Cannot recognize Rspack ${recipe.kind} in module ${id} (${entry.entry}).`);
        matches.push({ ...entry, ...found[0], requirement: recipe });
      }
    }
  }
  for (const recipe of recipes) {
    if (!matches.some(m => m.requirement === recipe)) throw new Error(`Missing Rspack ${recipe.kind} module ${recipe.module} in ${recipe.scope}.`);
  }
  return matches;
}

async function plan(entries, recipes = defaultRecipes) {
  const matches = collect(entries, recipes);
  const donors = matches.filter(m => m.recipe.kind === 'fast-icon-donor');
  const donor = donors[0] && donors[0].source.slice(donors[0].fn.start, donors[0].fn.end);
  const targets = [], checks = [];
  for (const entry of entries) {
    const edits = matches.filter(m => m.entry === entry.entry && !m.recipe.native).sort((a, b) => b.fn.start - a.fn.start);
    if (!edits.length) continue;
    let patched = entry.source;
    for (const match of edits) {
      match.patchedFunction = transform(entry.source, match.fn, match.recipe, donor);
      checks.push(...await validate(match));
      patched = patched.slice(0, match.fn.start) + match.patchedFunction + patched.slice(match.fn.end);
    }
    require('./adaptive.cjs').parse(patched);
    targets.push({ entry: entry.entry, sourceSha256: sha256(Buffer.from(entry.source)), patched: Buffer.from(patched),
      kinds: [...new Set(edits.map(m => m.recipe.kind))] });
  }
  return { targets, checks };
}

async function validate(match) {
  const { at } = require('./adaptive.cjs');
  const { recipe, patchedFunction: source } = match;
  if (!['ui', 'request', 'saved-request'].includes(recipe.kind)) return [];
  const fn = readFunction(source), text = `(${source})`;
  const checks = [], run = (code, context) => vm.runInNewContext(code, context, { timeout: 1000 });
  if (recipe.kind === 'ui') {
    const declarations = fn.body.body[0].declarations;
    const calls = index => declarations[index].init.callee.expressions.at(-1).object.name;
    const memo = calls(3), query = calls(4), auth = calls(6);
    const policy = new Set();
    walk.simple(fn, { MemberExpression(n) { if (n.property.name === 'W6') policy.add(n.object.name); } });
    for (const method of ['apikey', 'chatgpt', 'personalAccessToken', 'amazonBedrock', 'other', null]) {
      for (const loading of [false, true]) for (const pending of [false, true]) for (const allowed of [false, true]) {
        const access = allowed ? { priority: true } : null;
        const globals = { [memo]: { c: n => Array(n).fill(Symbol.for('react.memo_cache_sentinel')) },
          [query]: { Ul: () => 'local', _U: () => ({ data: {}, isPending: pending }) },
          [auth]: { tn: () => ({ authMethod: method, isLoading: loading }) },
          [declarations[4].init.arguments[0].object.name]: { Dc: {} } };
        const queryCall = fn.body.body[2].declarations[0].init;
        globals[queryCall.arguments[0].object.name] = { b9: {} };
        for (const name of policy) globals[name] = { W6: () => access };
        const result = run(`${text}({hostId:'local'})`, globals);
        const expected = ['apikey', 'chatgpt', 'personalAccessToken', 'amazonBedrock'].includes(method) && !loading && !pending && allowed;
        if ((result.serviceTierAccess != null) !== expected) throw new Error('Rspack UI gate verification failed.');
        checks.push({ kind: 'ui', auth: method, loading, pending, allowed, passed: true });
      }
    }
  } else if (recipe.kind === 'request') {
    const selector = at(fn, recipe.path.slice(0, -5));
    const statements = selector.body.body;
    const options = statements[0].test.right.name;
    const saved = statements[0].consequent.argument.callee.name;
    const conversation = statements[0].consequent.argument.arguments[0].left.expression.object.name;
    const client = statements[2].declarations[0].init.argument.callee.object.name;
    const code = `(${text.slice(selector.start, selector.end)})()`;
    for (const auth of ['apiKey', 'chatgpt', 'amazonBedrock', 'other', null]) for (const tier of ['priority', 'ultrafast', null, undefined]) {
      let queried = false;
      const result = await run(code, { [options]: { serviceTier: tier }, [saved]: () => { throw new Error('Unexpected default lookup.'); },
        [client]: { getAccount: async () => { queried = true; return { account: auth == null ? null : { type: auth } }; } } });
      const expected = tier != null && ['apiKey', 'chatgpt', 'amazonBedrock'].includes(auth) ? tier : null;
      if (result !== expected || queried !== (tier != null)) throw new Error('Rspack request gate verification failed.');
      checks.push({ kind: 'request', auth, tier: tier ?? null, passed: true });
    }
    for (const tier of ['priority', 'ultrafast', null]) {
      const result = await run(code, { [options]: null, [conversation]: { latestModel: 'selected-model' },
        [saved]: async model => { if (model !== 'selected-model') throw new Error('Saved model changed.'); return tier; } });
      if (result !== tier) throw new Error('Rspack saved-tier delegation changed.');
      checks.push({ kind: 'request', saved: true, tier, passed: true });
    }
  } else {
    const callback = at(fn, recipe.path.slice(0, -4));
    const client = fn.params[0].name;
    const runtime = fn.params[1].properties[0].value.name;
    const code = `(${text.slice(callback.start, callback.end)})()`;
    for (const auth of ['apiKey', 'chatgpt', 'amazonBedrock', 'other', null]) for (const copilot of [false, true]) {
      const result = await run(code, { [client]: { getHostId: () => 'local', getAccount: async () => ({ account: auth == null ? null : { type: auth } }) },
        [runtime]: { isUsingCopilotInference: async () => copilot } });
      if (result !== (!copilot && ['apiKey', 'chatgpt', 'amazonBedrock'].includes(auth))) throw new Error('Rspack saved-tier gate verification failed.');
      checks.push({ kind: 'saved-request', auth, copilot, passed: true });
    }
  }
  return checks;
}

function isRspack(archive, files) {
  return files.some(file => {
    if (!file.replaceAll('\\', '/').startsWith('webview/assets/async/')) return false;
    const info = asar.statFile(archive, file);
    return !info.unpacked && !info.link && info.size <= 32 * 1024 * 1024 &&
      asar.extractFile(archive, file).subarray(0, 150).toString().includes('__webpack_modules__');
  });
}

async function planArchive(archive, files) {
  const entries = [];
  for (const file of files) {
    const info = asar.statFile(archive, file);
    if (info.unpacked || info.link || info.size > 32 * 1024 * 1024) continue;
    entries.push({ entry: file, scope: file.replaceAll('\\', '/').startsWith('.vite/') ? 'main' : 'webview',
      source: asar.extractFile(archive, file).toString('utf8') });
  }
  return plan(entries);
}

module.exports = { modules, collect, transform, plan, validate, isRspack, planArchive };
