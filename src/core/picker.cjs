const walk = require('acorn-walk');
const defaultRecipes = require('./picker-recipe.json');

function adaptPicker(source, recipes = defaultRecipes) {
  const { parse, shape, at } = require('./adaptive.cjs');
  const matches = [];
  walk.simple(parse(source), { FunctionDeclaration(fn) {
    if (fn.end - fn.start > 5000 || !source.slice(fn.start, fn.end).includes('stripGptPrefix')) return;
    const fingerprint = shape(fn).fingerprint;
    const recipe = recipes.find(item => [item.fingerprint, item.patchedFingerprint].includes(fingerprint));
    if (recipe) matches.push({ fn, recipe, changed: fingerprint !== recipe.patchedFingerprint });
  } });
  for (const recipe of recipes) {
    if (matches.filter(match => match.recipe.kind === recipe.kind).length > 1) {
      throw new Error(`Cannot uniquely recognize ${recipe.kind} logic.`);
    }
  }
  let patched = source;
  for (const { fn, recipe } of matches.filter(match => match.changed).sort((a, b) => b.fn.start - a.fn.start)) {
    const target = at(fn, recipe.path);
    let start, end, value;
    if (recipe.kind === 'model-name') {
      if (target.type !== 'ConditionalExpression' || target.alternate.type !== 'Identifier') {
        throw new Error('Unrecognized model name formatter.');
      }
      start = target.start;
      end = target.end;
      value = source.slice(target.alternate.start, target.alternate.end);
    } else if (recipe.kind === 'default-model-presets') {
      if (target.type !== 'Identifier') throw new Error('Unrecognized Default model preset parameter.');
      start = end = fn.body.start + 1;
      // Reuse native capability filtering and prefer presets supplied by the account.
      value = `${target.name}??=${JSON.stringify({ presets: recipe.presets })};`;
    } else {
      throw new Error(`Unsupported picker recipe: ${recipe.kind}`);
    }
    const result = source.slice(fn.start, start) + value + source.slice(end, fn.end);
    if (shape(parse(result).body[0]).fingerprint !== recipe.patchedFingerprint) {
      throw new Error(`Unexpected transformed ${recipe.kind} logic.`);
    }
    patched = patched.slice(0, fn.start) + result + patched.slice(fn.end);
  }
  return { patched, matches: matches.map(({ recipe, changed }) => ({ kind: recipe.kind, changed })) };
}

module.exports = { adaptPicker };
