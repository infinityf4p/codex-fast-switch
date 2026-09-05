const fs = require('node:fs');
const path = require('node:path');
const walk = require('acorn-walk');
const defaultRecipe = JSON.parse(fs.readFileSync(path.join(__dirname, 'compact-recipe.json'), 'utf8'));

function transformCompactFunction(source, fn, role, other, recipe) {
  const { at } = require('./adaptive.cjs');
  const paths = recipe[role].paths;
  const read = node => source.slice(node.start, node.end);
  const target = key => at(fn, paths[key]);
  const edits = [{ node: target('prefix'), value: '!1' }];
  if (role === 'legacy') {
    const donor = key => at(other, recipe.modern.paths[key]);
    const gap = target('gap');
    const gapText = gap.type === 'Literal' ? gap.value : gap.quasis?.[0]?.value.cooked;
    if (typeof gapText !== 'string' || !gapText.split(' ').includes('gap-1.5')) throw new Error('Unrecognized compact picker spacing.');
    edits.push({ node: gap, value: JSON.stringify(gapText.split(' ').map(token => token === 'gap-1.5' ? 'gap-1' : token).join(' ')) });
    edits.push({ node: target('modelClass'), value: `(${read(target('modelClass'))}+" "+${read(donor('modelClass'))}+" "+${read(donor('parentClass'))})` });
    edits.push({ node: target('effortCollapse'), value: '"none"' });
    const effort = target('effortClass');
    if (effort.type !== 'ConditionalExpression' || effort.test.type !== 'LogicalExpression' || effort.test.operator !== '&&') {
      throw new Error('Unrecognized compact picker effort color.');
    }
    edits.push({ node: effort.test, value: read(effort.test.right) });
    const children = target('children');
    if (children.type !== 'ArrayExpression' || target('runtime').type !== 'Identifier' || target('hideLabel').type !== 'Identifier') {
      throw new Error('Unrecognized compact picker button.');
    }
    const nativeCall = (call, replacements = []) => {
      const runtime = call.callee?.expressions?.[1]?.object;
      if (runtime?.type !== 'Identifier') throw new Error('Unrecognized compact picker icon runtime.');
      let result = read(call);
      for (const replacement of [...replacements, { node: runtime, value: read(target('runtime')) }].sort((a, b) => b.node.start - a.node.start)) {
        result = result.slice(0, replacement.node.start - call.start) + replacement.value + result.slice(replacement.node.end - call.start);
      }
      return result;
    };
    // The native direct-child icon rule overrides the legacy label's 16px SVG rule.
    const glyph = nativeCall(donor('icon'), [{ node: donor('iconKind'), value: read(target('serviceTier')) }]);
    const before = target('glyphBefore');
    edits.push({ node: { start: before.start, end: before.start }, value: `${glyph},` });
    edits.push({ node: target('serviceTier'), value: 'null' });
    const chevron = nativeCall(donor('chevron'));
    edits.push({ node: children, value: `${read(children).slice(0, -1)},${read(target('hideLabel'))}?null:${chevron}]` });
  }
  let result = read(fn);
  for (const edit of edits.sort((a, b) => b.node.start - a.node.start)) {
    result = result.slice(0, edit.node.start - fn.start) + edit.value + result.slice(edit.node.end - fn.start);
  }
  return result;
}

function adaptCompact(source, recipe = defaultRecipe) {
  const { parse, shape } = require('./adaptive.cjs');
  const matches = { legacy: [], modern: [] };
  walk.simple(parse(source), { FunctionDeclaration(fn) {
    if (fn.end - fn.start > 32000 || !source.slice(fn.start, fn.end).includes('stripGptPrefix')) return;
    const fingerprint = shape(fn).fingerprint;
    for (const role of Object.keys(matches)) {
      if ([recipe[role].fingerprint, recipe[role].patchedFingerprint].includes(fingerprint)) {
        matches[role].push({ fn, patched: fingerprint === recipe[role].patchedFingerprint });
      }
    }
  } });
  if (!matches.legacy.length && !matches.modern.length) return { patched: source, matched: false, changed: false };
  if (matches.legacy.length !== 1 || matches.modern.length !== 1) throw new Error('Cannot uniquely recognize both compact model picker layouts.');
  const edits = [];
  for (const role of Object.keys(matches)) {
    const match = matches[role][0];
    if (match.patched) continue;
    const value = transformCompactFunction(source, match.fn, role, matches.modern[0].fn, recipe);
    if (shape(parse(value).body[0]).fingerprint !== recipe[role].patchedFingerprint) throw new Error(`Unexpected transformed ${role} compact picker.`);
    edits.push({ fn: match.fn, value });
  }
  let patched = source;
  for (const edit of edits.sort((a, b) => b.fn.start - a.fn.start)) {
    patched = patched.slice(0, edit.fn.start) + edit.value + patched.slice(edit.fn.end);
  }
  parse(patched);
  return { patched, matched: true, changed: edits.length > 0 };
}

module.exports = { adaptCompact, transformCompactFunction };
