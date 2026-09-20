const { planArchive } = require('../../core/adaptive.cjs');
const pickerRecipes = require('../../core/picker-recipe.json');
const features = ['fast-icon', 'compact-model-control', 'compact-colors', ...pickerRecipes.map(recipe => recipe.kind)];

async function planWindowsArchive(archive, { plan = planArchive } = {}) {
  const disabled = new Set(), reasons = [];
  let options = [];
  while (true) {
    try {
      const prepared = await plan(archive, ...options);
      return disabled.size ? { ...prepared, compatibility: {
        nativeAppearance: true, nativeAppearanceFeatures: [...disabled], reason: reasons.join(' '),
        compactColors: prepared.targets.some(target => target.kinds?.includes('compact-colors')),
      } } : prepared;
    } catch (error) {
      if (error.code !== 'UNSUPPORTED_APPEARANCE') throw error;
      const affected = error.appearance === 'model-picker' ? pickerRecipes.map(recipe => recipe.kind) : [error.appearance];
      if (affected.some(feature => !features.includes(feature)) || affected.every(feature => disabled.has(feature))) throw error;
      affected.forEach(feature => disabled.add(feature));
      reasons.push(error.message);
      // Replan the original archive, disabling only the incompatible appearance
      // feature. Keep matching model names and glyphs when the layout changes.
      options = [undefined, disabled.has('fast-icon') ? null : undefined,
        disabled.has('compact-model-control') ? null : undefined,
        pickerRecipes.filter(recipe => !disabled.has(recipe.kind)),
        disabled.has('compact-model-control') && !disabled.has('compact-colors')];
    }
  }
}

module.exports = { planWindowsArchive };
