const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const platform = require('./platform.cjs');
const integrity = require('./integrity.cjs');
const { planArchive } = require('../../core/adaptive.cjs');
const { patchArchive, sha256 } = require('../../core/archive.cjs');
const { saveJson, readJson, withLock } = require('../../core/state.cjs');

const PATCH_ID = 'codex-fast-switch-windows-v1';
const PATCH_REVISION = 2;
const configPath = state => path.join(state, 'windows.json');
const activePath = state => path.join(state, 'windows-active.json');
const statusPath = state => path.join(state, 'windows-status.json');
const readOptional = file => fs.existsSync(file) ? readJson(file) : null;
function contained(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkedActive(state) {
  state = path.resolve(state);
  const record = readOptional(activePath(state));
  if (!record) return null;
  if (record.patchId !== PATCH_ID || !/^\d+-[a-f0-9-]{36}$/.test(record.id) ||
      record.app !== path.join(state, 'versions', record.id, 'app') || !record.source || !record.patched || !record.original ||
      !Number.isSafeInteger(record.revision ?? 1) || (record.revision ?? 1) < 1) {
    throw new Error('Invalid Windows installation record.');
  }
  if (!fs.existsSync(record.app) || !contained(fs.realpathSync(state), fs.realpathSync(record.app))) {
    throw new Error('The installed copy is missing or points outside the state directory.');
  }
  return record;
}
function status(state) {
  return { state, configuration: readOptional(configPath(state)), active: checkedActive(state), lastCheck: readOptional(statusPath(state)) };
}
function resolveSource(state, explicit) {
  if (explicit) return platform.discoverApp(explicit);
  const config = readOptional(configPath(state));
  return platform.discoverApp(config?.autoDiscover === false ? config.source : undefined);
}
function assertSeparate(source, state) {
  const realSource = fs.realpathSync(source);
  let existing = path.resolve(state);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const realState = path.resolve(fs.realpathSync(existing), path.relative(existing, path.resolve(state)));
  if (realState.toLowerCase() === realSource.toLowerCase() || contained(realSource, realState) || contained(realState, realSource)) {
    throw new Error('The source app and --state directory must be separate directories.');
  }
}
function copyApp(source, target) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  function copy(from, to) {
    const info = fs.lstatSync(from);
    if (info.isSymbolicLink()) throw new Error('App symlinks and junctions are unsupported.');
    if (info.isDirectory()) {
      fs.mkdirSync(to);
      for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
      return;
    }
    if (!info.isFile()) throw new Error('Unsupported app file type.');
    // CopyFile can reject MSIX-backed files even when their content is readable.
    const input = fs.openSync(from, 'r');
    let output;
    try {
      output = fs.openSync(to, 'wx', info.mode);
      let size;
      while ((size = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
        let written = 0;
        while (written < size) written += fs.writeSync(output, buffer, written, size - written);
      }
    } finally {
      fs.closeSync(input);
      if (output !== undefined) fs.closeSync(output);
    }
  }
  copy(source, target);
}

// Each generation is immutable after publication. One JSON rename publishes it;
// interruption during copying or patching leaves the previous target available.
async function install(source, state, { onPhase = () => {}, verify = platform.verify, plan = planArchive,
  stopped = platform.assertStopped, copy = copyApp } = {}) {
  state = path.resolve(state);
  source = platform.normalizeApp(source);
  assertSeparate(source, state);
  const current = checkedActive(state);
  if ((current?.revision ?? 1) > PATCH_REVISION) throw new Error('The installed copy requires a newer Fast Switch installer.');
  if (current) stopped([current.app]);
  if (fs.existsSync(path.join(source, 'resources/codex-fast-switch.json'))) throw new Error('Select the original app, not a patched copy.');
  onPhase('verifying-source');
  const info = verify(source);
  const original = platform.fingerprint(source);
  if (current && current.source === source && JSON.stringify(current.original) === JSON.stringify(original)) {
    if (!platform.same(current.app, current.patched)) throw new Error('The installed copy has changed. Restore it before applying again.');
    if ((current.revision ?? 1) === PATCH_REVISION) {
      return { status: 'already-installed', app: current.app, revision: PATCH_REVISION, ...info };
    }
  }
  onPhase('recognizing');
  const prepared = await plan(platform.archivePath(source));
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const directory = path.join(state, 'versions', id);
  const app = path.join(directory, 'app');
  fs.mkdirSync(directory, { recursive: true });
  if (!contained(fs.realpathSync(state), fs.realpathSync(directory))) throw new Error('The versions directory must stay inside the state directory.');
  const record = { patchId: PATCH_ID, revision: PATCH_REVISION, id, app, source, original, ...info, phase: 'staging' };
  const journal = path.join(directory, 'record.json');
  saveJson(journal, record);
  try {
    onPhase('copying');
    copy(source, app);
    if (!platform.same(app, original)) throw new Error('Source changed while copying. The previous launch target is preserved.');
    const originalHeader = integrity.headerHash(app);
    onPhase('patching');
    for (const target of prepared.targets) {
      patchArchive(platform.archivePath(app), target.entry, bytes => {
        if (sha256(bytes) !== target.sourceSha256) throw new Error('Source archive changed while patching.');
        return target.patched;
      });
    }
    record.integrity = integrity.patch(app, originalHeader);
    record.patched = platform.fingerprint(app);
    record.checks = prepared.checks.length;
    saveJson(path.join(app, 'resources/codex-fast-switch.json'), { patchId: PATCH_ID, revision: PATCH_REVISION, id,
      archiveSha256: record.patched['resources/app.asar'], checks: record.checks });
    verify(app, { patched: true });
    if (!platform.same(source, original)) throw new Error('The original app updated during preparation. Retry using the new version.');
    if (current) stopped([current.app]);
    record.phase = 'prepared';
    saveJson(journal, record);
    onPhase('prepared');
    if (current) stopped([current.app]);
    record.phase = 'installed';
    record.installedAt = new Date().toISOString();
    saveJson(journal, record);
    saveJson(activePath(state), record);
    return { status: 'installed', app, source, revision: PATCH_REVISION, ...info, checks: record.checks, originalUnchanged: true };
  } catch (error) {
    record.phase = 'failed';
    record.error = error.message;
    saveJson(journal, record);
    throw error;
  }
}
function restore(state, { stopped = platform.assertStopped } = {}) {
  const current = checkedActive(state);
  if (current) stopped([current.app]);
  if (fs.existsSync(activePath(state))) fs.unlinkSync(activePath(state));
  return { status: current ? 'restored' : 'already-original', originalUnchanged: true,
    nextStep: 'Open the original Codex / ChatGPT app from the Start menu. Local copies are retained in the state directory.' };
}
async function doctor(source) {
  const info = platform.verify(source);
  const prepared = await planArchive(platform.archivePath(source));
  return { status: 'recognized', app: source, ...info, mode: 'local-copy', originalUnchanged: true, gateCases: prepared.checks.length,
    targets: prepared.targets.map(target => ({ entry: target.entry.replaceAll('\\', '/'), kinds: target.kinds })) };
}
module.exports = { PATCH_ID, PATCH_REVISION, configPath, activePath, statusPath, readOptional, checkedActive, status, resolveSource,
  contained, assertSeparate, copyApp, install, restore, doctor, saveJson, withLock };
