const { planArchive } = require('../../core/adaptive.cjs');

async function planWindowsArchive(archive, { plan = planArchive } = {}) {
  try { return await plan(archive); }
  catch (error) {
    if (error.code !== 'UNSUPPORTED_APPEARANCE') throw error;
    // Cosmetic changes must not block a verified Fast implementation in a new app.
    // Replan from the original archive so no partially matched styling is retained.
    const prepared = await plan(archive, undefined, null, null, null);
    return { ...prepared, compatibility: { nativeAppearance: true, reason: error.message } };
  }
}

module.exports = { planWindowsArchive };
