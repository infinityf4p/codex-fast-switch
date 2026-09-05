const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { sha256 } = require('./archive.cjs');
const defaultRecipes = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8'));
const defaultIconRecipe = JSON.parse(fs.readFileSync(path.join(__dirname, 'icon-recipe.json'), 'utf8'));

const parse = source => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const stableNames = new Set(['undefined', 'NaN', 'Infinity', 'Set', 'Map', 'Array', 'Object', 'Symbol', 'JSON', 'Math', 'Promise']);
function shape(root) {
  const names = [];
  function visit(node, parent, key) {
    if (typeof node === 'bigint') return { bigint: node.toString() };
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(item => visit(item, parent, key));
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return { type: 'Literal', value: node.quasis[0].value.cooked };
    }
    if (node.type === 'Identifier') {
      const property = parent && !parent.computed &&
        ((parent.type === 'MemberExpression' && key === 'property') ||
         (parent.type === 'Property' && key === 'key'));
      if (property || stableNames.has(node.name)) return { type: 'Identifier', name: node.name };
      if (!names.includes(node.name)) names.push(node.name);
      return { type: 'Identifier', name: `$${names.indexOf(node.name)}` };
    }
    const out = {};
    for (const key of Object.keys(node).sort()) {
      if (['start', 'end', 'loc', 'range', 'raw'].includes(key)) continue;
      out[key] = visit(node[key], node, key);
    }
    return out;
  }
  return { fingerprint: sha256(JSON.stringify(visit(root))), names };
}
function at(root, keys) { return keys.reduce((node, key) => node[key], root); }
function nodePath(root, target, keys = []) {
  if (root === target) return keys;
  if (!root || typeof root !== 'object') return null;
  for (const [key, value] of Object.entries(root)) {
    if (value && typeof value === 'object') {
      const result = nodePath(value, target, [...keys, Array.isArray(root) ? Number(key) : key]);
      if (result) return result;
    }
  }
  return null;
}
function replacement(source, fn, target, kind) {
  const original = source.slice(target.start, target.end);
  if (kind === 'models') {
    if (fn.params[1]?.type !== 'Identifier' || target.type !== 'Identifier') throw new Error('Unsupported model query arguments.');
    return `{...${original},additionalAvailableModels:new Set([${fn.params[1].name}.model])}`;
  }
  if (target.type !== 'BinaryExpression') throw new Error('Unsupported authentication check.');
  const left = source.slice(target.left.start, target.left.end);
  return kind === 'ui' ? `(${original}||${left}==="apikey")` : `(${original}&&${left}!=="apikey")`;
}

// Whole-function fingerprints retain control flow, property names, and values.
// Only identifier spelling, comments, whitespace, and string quote style vary.
function adapt(source, recipes) {
  const ast = parse(source);
  const matches = [];
  walk.simple(ast, {
    FunctionDeclaration(fn) {
      if (fn.end - fn.start > 15000) return;
      const body = source.slice(fn.start, fn.end);
      if (!body.includes('fast_mode') && !body.includes('serviceTierForRequest')) return;
      const normalized = shape(fn);
      const recipe = recipes.find(item => item.fingerprint === normalized.fingerprint);
      if (recipe) matches.push({ fn, recipe, names: normalized.names });
    },
  });
  const edits = matches.map(match => {
    const target = at(match.fn, match.recipe.path);
    return { ...match, start: target.start, end: target.end,
      value: replacement(source, match.fn, target, match.recipe.kind) };
  });
  let patched = source;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    patched = patched.slice(0, edit.start) + edit.value + patched.slice(edit.end);
  }
  parse(patched);
  for (const match of matches) {
    const original = source.slice(match.fn.start, match.fn.end);
    const edit = edits.find(item => item.fn === match.fn);
    match.patchedFunction = original.slice(0, edit.start - match.fn.start) + edit.value + original.slice(edit.end - match.fn.start);
    const patchedFn = parse(match.patchedFunction).body[0];
    if (shape(patchedFn).fingerprint !== match.recipe.patchedFingerprint) throw new Error('Unexpected transformed function.');
  }
  return { patched, matches };
}

async function validateGates(matches) {
  const ui = matches.find(item => item.recipe.kind === 'ui');
  const request = matches.find(item => item.recipe.kind === 'request');
  const results = [];
  for (const auth of ['apikey', 'chatgpt', null]) {
    for (const blocked of [false, true]) {
      for (const loading of [false, true]) {
        const requirements = { requirements: { featureRequirements: { fast_mode: !blocked } } };
        const stubs = {
          memo: { c: count => Array(count).fill(Symbol.for('react.memo_cache_sentinel')) },
          host: () => 'local', value: {}, auth: () => ({ authMethod: auth, isLoading: loading }),
          query: () => ({ data: requirements, isPending: false }),
          readAuth: async () => auth, readRequirements: async () => requirements,
        };
        const allowed = auth !== null && !blocked;
        for (const [match, expected] of [[ui, allowed && !loading], [request, allowed]]) {
          const globals = {};
          for (const item of match.recipe.environment) globals[match.names[item.index]] = stubs[item.stub];
          globals.client = { query: { setData() {} } };
          const context = vm.createContext(globals);
          const invoke = match.recipe.kind === 'ui' ? '({hostId:"local"}).isServiceTierAllowed' : '(client,"local")';
          const result = await vm.runInContext(`(${match.patchedFunction})${invoke}`, context, { timeout: 1000 });
          if (result !== expected) throw new Error(`Gate verification failed: ${match.recipe.kind}, ${auth}, ${blocked}, ${loading}`);
        }
        results.push({ auth, blocked, loading, passed: true });
      }
    }
  }
  return results;
}

function adaptFastIcon(source, recipe = defaultIconRecipe) {
  const outlines = [], solids = [], patched = [];
  walk.simple(parse(source), {
    ArrowFunctionExpression(fn) {
      if (fn.end - fn.start > 5000 || !source.slice(fn.start, fn.end).includes('viewBox')) return;
      const fingerprint = shape(fn).fingerprint;
      if (fingerprint === recipe.sourceFingerprint) outlines.push(fn);
      if (fingerprint === recipe.solidFingerprint) solids.push(fn);
      if (fingerprint === recipe.patchedFingerprint) patched.push(fn);
    },
  });
  if (!outlines.length && !patched.length) return { patched: source, matched: false, changed: false };
  if (outlines.length + patched.length !== 1) throw new Error('Cannot uniquely recognize the Fast icon.');
  if (patched.length) return { patched: source, matched: true, changed: false };
  if (!solids.length) throw new Error('The matching filled Fast icon is unavailable.');
  const property = (fn, key) => {
    const values = [];
    walk.simple(fn, { Property(node) {
      if (!node.computed && (node.key.name || node.key.value) === key) values.push(node.value);
    } });
    if (values.length !== 1) throw new Error(`Unrecognized Fast icon property: ${key}`);
    return values[0];
  };
  const outline = outlines[0];
  let replacement = source.slice(outline.start, outline.end);
  // Reuse the bundled filled glyph while retaining the original component's size and props.
  const edits = ['viewBox', 'd'].map(key => ({ target: property(outline, key), donor: property(solids[0], key) }));
  for (const { target, donor } of edits.sort((a, b) => b.target.start - a.target.start)) {
    replacement = replacement.slice(0, target.start - outline.start) + source.slice(donor.start, donor.end) + replacement.slice(target.end - outline.start);
  }
  if (shape(parse(`(${replacement})`).body[0].expression).fingerprint !== recipe.patchedFingerprint) {
    throw new Error('Unexpected filled Fast icon structure.');
  }
  return { patched: source.slice(0, outline.start) + replacement + source.slice(outline.end), matched: true, changed: true };
}

async function planArchive(archive, recipes = defaultRecipes, iconRecipe = recipes === defaultRecipes ? defaultIconRecipe : null) {
  const asar = require('@electron/asar');
  asar.uncacheAll();
  const files = asar.listPackage(archive).map(file => file.replace(/^\//, ''))
    .filter(file => file.startsWith('webview/') && file.endsWith('.js'));
  const targets = [];
  const allMatches = [];
  let iconMatches = 0;
  for (const entry of files) {
    const info = asar.statFile(archive, entry);
    if (info.unpacked || info.link || info.size > 32 * 1024 * 1024) continue;
    const bytes = asar.extractFile(archive, entry);
    const source = bytes.toString('utf8');
    if (!source.includes('fast_mode') && !source.includes('serviceTierForRequest') && !(iconRecipe && source.includes('serviceTierIconKind'))) continue;
    const result = adapt(source, recipes);
    const icon = iconRecipe && source.includes('serviceTierIconKind') ? adaptFastIcon(result.patched, iconRecipe) : null;
    if (icon?.matched) iconMatches++;
    if (!result.matches.length && !icon?.changed) continue;
    allMatches.push(...result.matches);
    targets.push({ entry, sourceSha256: sha256(bytes), patched: Buffer.from(icon?.patched ?? result.patched),
      kinds: [...result.matches.map(item => item.recipe.kind), ...(icon?.changed ? ['fast-icon'] : [])] });
  }
  for (const recipe of recipes) {
    if (allMatches.filter(item => item.recipe.kind === recipe.kind).length !== 1) {
      throw new Error(`Cannot uniquely recognize ${recipe.kind} logic. The official app will be kept unchanged.`);
    }
  }
  if (iconRecipe && iconMatches !== 1) throw new Error('Cannot uniquely recognize the Fast icon. The official app will be kept unchanged.');
  return { targets, checks: await validateGates(allMatches) };
}
module.exports = { parse, shape, at, nodePath, replacement, adapt, adaptFastIcon, validateGates, planArchive };
