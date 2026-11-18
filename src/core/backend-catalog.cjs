const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./archive.cjs');
const FILE = 'codex-fast-service-tiers.json';
const supported = new Set(['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-sol', 'gpt-6-astra']);

function extract(bytes) {
  const markers = ['{\n  "models": [', '{\r\n  "models": ['].map(value => Buffer.from(value));
  const catalogs = [];
  for (const marker of markers) for (let start = bytes.indexOf(marker); start !== -1; start = bytes.indexOf(marker, start + marker.length)) {
    let depth = 0, quoted = false, escaped = false, end;
    for (let i = start; i < Math.min(bytes.length, start + 8 * 1024 * 1024); i++) {
      const c = bytes[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === 92) escaped = true;
        else if (c === 34) quoted = false;
        continue;
      }
      if (c === 34) quoted = true;
      else if (c === 123 || c === 91) depth++;
      else if ((c === 125 || c === 93) && --depth === 0) { end = i + 1; break; }
    }
    if (!end) throw new Error('Incomplete bundled model metadata.');
    const catalog = JSON.parse(bytes.subarray(start, end).toString('utf8'));
    if (!Array.isArray(catalog.models) || !catalog.models.length || catalog.models.length > 200 ||
        catalog.models.some(m => typeof m.slug !== 'string' || !Array.isArray(m.service_tiers)) ||
        new Set(catalog.models.map(m => m.slug)).size !== catalog.models.length) throw new Error('Unknown bundled model metadata.');
    catalogs.push(catalog);
  }
  if (!catalogs.length || catalogs.some(c => JSON.stringify(c) !== JSON.stringify(catalogs[0]))) {
    throw new Error('Missing or inconsistent bundled model metadata.');
  }
  return catalogs[0];
}

function supplement(original) {
  const catalog = structuredClone(original);
  // Hidden entries provide backend metadata only for an explicitly configured
  // model. They do not add new choices to the normal model list or its default.
  for (const [slug, previous, display] of [
    ['gpt-6.2-sol', 'gpt-6.1-sol', 'GPT-6.2 Sol'], ['gpt-6.2-astra', 'gpt-6-astra', 'GPT-6.2 Astra'],
  ]) {
    if (catalog.models.some(m => m.slug === slug)) continue;
    const template = catalog.models.find(m => m.slug === previous);
    if (!template || template.visibility !== 'list' || template.supported_in_api !== true) {
      throw new Error(`Missing public metadata template: ${previous}.`);
    }
    catalog.models.push({ ...structuredClone(template), slug, display_name: display, visibility: 'hide',
      priority: 999, availability_nux: null, upgrade: null, default_service_tier: null });
  }
  for (const model of catalog.models) {
    if (!supported.has(model.slug) || model.supported_in_api !== true || model.available_access_programs ||
        !model.service_tiers.some(t => t.id === 'priority') || model.service_tiers.some(t => t.id === 'ultrafast')) continue;
    model.service_tiers.push({ id: 'ultrafast', name: 'Ultrafast',
      description: 'The fastest available responses for latency-sensitive work' });
    model.additional_speed_tiers = [...new Set([...(model.additional_speed_tiers ?? []), 'ultrafast'])];
  }
  return catalog;
}

function prepare(source, platform) {
  const resources = platform === 'win32' ? 'resources' : 'Contents/Resources';
  const candidates = platform === 'win32' ? ['codex.exe'] : ['codex-cli/CodexCLI.app/Contents/MacOS/codex', 'codex'];
  const binary = candidates.map(p => path.join(source, resources, p)).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!binary) throw new Error('Bundled backend unavailable for speed metadata.');
  const catalog = supplement(extract(fs.readFileSync(binary)));
  const data = Buffer.from(JSON.stringify(catalog));
  return { data, models: catalog.models.filter(m => supported.has(m.slug)).map(m => m.slug) };
}

function copy(source, destination, platform, prepared = prepare(source, platform)) {
  const resources = platform === 'win32' ? 'resources' : 'Contents/Resources';
  const { data, models } = prepared;
  fs.writeFileSync(path.join(destination, resources, FILE), data);
  return { sha256: sha256(data), models };
}

module.exports = { FILE, extract, supplement, prepare, copy };
