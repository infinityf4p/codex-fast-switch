const path = require('node:path');
const asar = require('@electron/asar');
const walk = require('acorn-walk');
const { parse, shape } = require('../../core/adaptive.cjs');
const { sha256 } = require('../../core/archive.cjs');
const createUpdater = require('./updater-client.cjs');

const fingerprints = new Set([
  '904d7d58609b8cef3a887aa15df7d0415aec8ebc0b143f1cf6cd70e673d1cd33',
  '4f06ea44ee19f049243c399309175dc42d55a069d6a11ccd2138d2bbaabd4935',
]);
const unsupported = () => Object.assign(new Error('Cannot uniquely recognize the Windows updater. The previous copy is preserved.'),
  { code: 'UNSUPPORTED_UPDATER' });

function adapt(source, binding, accepted = fingerprints) {
  const matches = [];
  walk.simple(parse(source), { ClassBody(node) {
    const methods = node.body.filter(item => item.type === 'MethodDefinition' && !item.computed);
    const names = new Set(methods.map(item => item.key.name));
    const target = methods.find(item => item.key.name === 'initializeWindowsUpdater');
    if (!target) return;
    if (!['setUpdateReady', 'setUpdateLifecycleState', 'checkForUpdates', 'installUpdatesIfAvailable', 'getIsUpdateReady']
      .every(name => names.has(name)) || !accepted.has(shape(target).fingerprint)) throw unsupported();
    matches.push(target.value.body);
  } });
  if (!matches.length) return null;
  if (matches.length !== 1) throw unsupported();
  const body = matches[0];
  const replacement = '{this.updater=(' + createUpdater.toString() + ')(this,' + JSON.stringify(binding) + ');' +
    'this.lastUnavailableReason=null;this.updater.initialize();}';
  const patched = source.slice(0, body.start) + replacement + source.slice(body.end);
  parse(patched);
  return Buffer.from(patched);
}

function planArchive(archive, binding) {
  asar.uncacheAll();
  const targets = [];
  for (const file of asar.listPackage(archive)) {
    const entry = file.replaceAll('\\', '/').replace(/^\//, '');
    if (!entry.startsWith('.vite/build/') || !entry.endsWith('.js')) continue;
    const normalized = path.normalize(entry);
    const info = asar.statFile(archive, normalized);
    if (info.unpacked || info.link || info.size > 32 * 1024 * 1024) continue;
    const bytes = asar.extractFile(archive, normalized);
    const source = bytes.toString('utf8');
    if (!source.includes('initializeWindowsUpdater')) continue;
    const patched = adapt(source, binding);
    if (patched) targets.push({ entry: normalized, sourceSha256: sha256(bytes), patched, kinds: ['native-windows-updater'] });
  }
  if (targets.length !== 1) throw unsupported();
  return targets;
}

module.exports = { adapt, planArchive };
