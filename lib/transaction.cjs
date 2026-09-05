const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { sha256, patchArchive } = require('./archive.cjs');
const { assertStopped, identityFiles, discoverApp } = require('./platform.cjs');
const { planArchive } = require('./adaptive.cjs');
const signing = require('./signing.cjs');

const DEFAULT_STATE = path.join(os.homedir(), 'Library/Application Support/Codex Fast Switch');
const PATCH_ID = 'codex-fast-switch-v1';
const PATCH_REVISION = 4;
const MARKER = 'Contents/Resources/codex-fast-switch.json';
const archivePath = app => path.join(app, 'Contents/Resources/app.asar');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fingerprint = app => Object.fromEntries(identityFiles(app).map(file => [file, sha256(fs.readFileSync(path.join(app, file)))]));
function saveJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function verify(app, official = false) {
  const args = ['--verify', '--deep', '--strict'];
  if (official) args.push('-R', '=identifier "com.openai.codex" and anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"');
  execFileSync('/usr/bin/codesign', [...args, app], { stdio: 'pipe' });
}
function version(app) {
  asar.uncacheAll();
  const pkg = JSON.parse(asar.extractFile(archivePath(app), 'package.json'));
  return { version: pkg.version, build: String(pkg.codexBuildNumber) };
}
function swap(left, right) {
  execFileSync(path.join(__dirname, 'native-helper'), ['swap', left, right], { stdio: 'pipe' });
}
function marker(app) {
  if (fs.existsSync(path.join(app, 'Contents/Resources/codex-fast-local-patch.json'))) {
    throw new Error('Restore the earlier Codex Fast Patch using its original installer before using Codex Fast Switch.');
  }
  const file = path.join(app, MARKER);
  return fs.existsSync(file) ? readJson(file) : null;
}
function same(app, expected) {
  try { return fs.existsSync(app) && equal(fingerprint(app), expected); } catch { return false; }
}
function recordPath(state) { return path.join(state, 'automatic-active.json'); }
function recordSave(state, record) {
  saveJson(path.join(record.directory, 'record.json'), record);
  saveJson(recordPath(state), record);
}
function checkedRecord(state, app) {
  state = path.resolve(state);
  app = fs.realpathSync(app);
  const file = recordPath(state);
  if (!fs.existsSync(file)) return null;
  const record = readJson(file);
  const directory = path.join(state, 'automatic-backups', record.id);
  if (!/^[0-9]+-[a-f0-9-]+$/.test(record.id) || record.app !== app || record.directory !== directory ||
      record.backup !== path.join(directory, 'Original.app') ||
      path.dirname(record.stageDir) !== path.dirname(app) || !path.basename(record.stageDir).startsWith('.codex-fast-auto-') ||
      record.stage !== path.join(record.stageDir, 'Candidate.app')) throw new Error('Invalid recovery record.');
  return record;
}

async function withLock(state, fn) {
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const lock = path.join(state, 'automatic.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let alive = true;
      try { process.kill(readJson(path.join(lock, 'owner.json')).pid, 0); }
      catch (error) {
        alive = error.code !== 'ESRCH' && !(error.code === 'ENOENT' && Date.now() - fs.statSync(lock).mtimeMs > 120000);
      }
      if (alive || attempt) return { status: 'busy' };
      fs.rmSync(lock, { recursive: true });
    }
  }
  saveJson(path.join(lock, 'owner.json'), { pid: process.pid });
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function stage(app, destination, plan, metadata, state) {
  const identity = signing.ensureIdentity(state);
  execFileSync('/bin/cp', ['-cR', app, destination]);
  let hashes;
  for (const target of plan.targets) {
    hashes = patchArchive(archivePath(destination), target.entry, bytes => {
      if (sha256(bytes) !== target.sourceSha256) throw new Error('Source changed during staging.');
      return target.patched;
    });
  }
  execFileSync('/usr/libexec/PlistBuddy', ['-c',
    `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hashes.headerSha256}`, path.join(destination, 'Contents/Info.plist')]);
  saveJson(path.join(destination, MARKER), { patchId: PATCH_ID, revision: PATCH_REVISION, ...metadata,
    signingCertificateSha256: identity.certificateSha256,
    archiveSha256: hashes.patchedArchiveSha256, entries: plan.targets.map(target => ({ entry: target.entry, sha256: sha256(target.patched) })) });
  execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.FinderInfo', destination]);
  signing.sign(destination, state, { entitlements: path.join(__dirname, 'local-entitlements.plist'),
    expectedCertificateSha256: identity.certificateSha256 });
  verify(destination);
  return identity.certificateSha256;
}

function rollback(state, record, phase = 'rolled-back') {
  assertStopped(record.app);
  const current = marker(record.app);
  if (current?.patchId !== PATCH_ID || current.id !== record.id) throw new Error('App changed after installation; automatic rollback refused.');
  const original = [record.backup, record.stage].find(candidate => same(candidate, record.original));
  if (!original) throw new Error('Verified original backup is unavailable.');
  verify(original, true);
  record.phase = 'rollback-pending';
  recordSave(state, record);
  // Exchange complete bundles, so the original app path is never absent.
  swap(record.app, original);
  if (!same(record.app, record.original)) {
    swap(record.app, original);
    throw new Error('Restoration integrity check failed.');
  }
  const retired = path.join(record.directory, `Removed patched ${Date.now()}.app`);
  fs.renameSync(original, retired);
  record.phase = phase;
  record.restoredAt = new Date().toISOString();
  record.retired = retired;
  recordSave(state, record);
  if (fs.existsSync(record.stageDir) && !fs.readdirSync(record.stageDir).length) fs.rmdirSync(record.stageDir);
  return { status: phase, app: record.app, originalVersion: record.version };
}

function recover(app, state) {
  const record = checkedRecord(state, app);
  if (!record || !['prepared', 'activated', 'rollback-pending'].includes(record.phase)) return null;
  assertStopped(app);
  if (same(app, record.original)) {
    record.phase = 'aborted';
    recordSave(state, record);
    if (fs.existsSync(record.stageDir)) fs.rmSync(record.stageDir, { recursive: true });
    return { status: 'aborted', app };
  }
  if (marker(app)?.id !== record.id) throw new Error('An interrupted transaction found a newer app. No app was overwritten.');
  return rollback(state, record);
}

async function install(app = discoverApp(), state = DEFAULT_STATE, { check, onPhase = () => {}, model } = {}) {
  app = fs.realpathSync(app);
  state = path.resolve(state);
  assertStopped(app);
  const recovery = recover(app, state);
  if (recovery) return recovery;
  const current = marker(app);
  if (current) {
    const record = checkedRecord(state, app);
    if (current.patchId === PATCH_ID && record?.phase === 'installed' && same(app, record.patched)) {
      if (current.revision !== PATCH_REVISION) {
        const revision = current.revision ?? 1;
        if (!Number.isSafeInteger(revision) || revision < 1 || revision > PATCH_REVISION) {
          throw new Error('This installed patch requires a newer version of Codex Fast Switch.');
        }
        rollback(state, record, 'restored');
        return install(app, state, { check, onPhase, model });
      }
      verify(app);
      return { status: 'already-installed', ...version(app) };
    }
    throw new Error('An existing patch or unrecognized edit is present. Restore it before enabling automatic patches.');
  }
  verify(app, true);
  const original = fingerprint(app);
  const appVersion = version(app);
  onPhase('recognizing');
  const plan = await planArchive(archivePath(app));
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  signing.ensureIdentity(state, { expectedCertificateSha256: checkedRecord(state, app)?.signingCertificateSha256 });
  if (fs.statSync(state).dev !== fs.statSync(app).dev) throw new Error('App and backup must be on the same filesystem.');
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const directory = path.join(state, 'automatic-backups', id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stageDir = fs.mkdtempSync(path.join(path.dirname(app), '.codex-fast-auto-'));
  const destination = path.join(stageDir, 'Candidate.app');
  const record = { id, directory, app, backup: path.join(directory, 'Original.app'), stageDir,
    stage: destination, original, ...appVersion, phase: 'staging' };
  let exchanged = false;
  try {
    onPhase('staging');
    record.signingCertificateSha256 = await stage(app, destination, plan, { id, ...appVersion }, state);
    record.patched = fingerprint(destination);
    if (check) {
      onPhase('health-check');
      record.health = await check(destination, { model, onProgress: event => onPhase('health-progress', event) });
      if (!record.health?.passed) throw new Error('Patched app did not pass the health check.');
    }
    assertStopped(app);
    if (!same(app, original)) throw new Error('Official app changed during patching. No update was overwritten.');
    record.phase = 'prepared';
    recordSave(state, record);
    onPhase('prepared');
    assertStopped(app);
    swap(app, destination);
    exchanged = true;
    if (!same(destination, original)) {
      swap(app, destination);
      exchanged = false;
      throw new Error('App changed at activation; the displaced app was put back.');
    }
    onPhase('exchanged');
    fs.renameSync(destination, record.backup);
    record.phase = 'activated';
    recordSave(state, record);
    onPhase('activated');
    if (!same(app, record.patched)) throw new Error('Activated app failed integrity verification.');
    record.phase = 'installed';
    record.installedAt = new Date().toISOString();
    recordSave(state, record);
    return { status: 'installed', ...appVersion, backup: record.backup, checks: plan.checks.length, health: record.health };
  } catch (error) {
    if (exchanged) {
      try { rollback(state, record); }
      catch (restoreError) {
        record.phase = 'rollback-pending';
        record.error = error.message;
        record.rollbackError = restoreError.message;
        recordSave(state, record);
        throw new Error(`${error.message} Rollback is pending: ${restoreError.message}`);
      }
    } else {
      record.phase = 'failed-before-activation';
      record.error = error.message;
      saveJson(path.join(directory, 'record.json'), record);
      if (fs.existsSync(recordPath(state)) && readJson(recordPath(state)).id === id) recordSave(state, record);
    }
    throw error;
  } finally {
    if (!exchanged && fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
    else if (fs.existsSync(stageDir) && !fs.readdirSync(stageDir).length) fs.rmdirSync(stageDir);
  }
}

function restore(app = discoverApp(), state = DEFAULT_STATE) {
  app = fs.realpathSync(app);
  state = path.resolve(state);
  assertStopped(app);
  const recovery = recover(app, state);
  if (recovery) return recovery;
  const record = checkedRecord(state, app);
  if (!record) throw new Error('No automatic patch backup exists.');
  if (['restored', 'rolled-back', 'aborted', 'failed-before-activation'].includes(record.phase)) return { status: 'already-restored' };
  if (!same(app, record.patched)) throw new Error('App changed since patching. The newer app will not be overwritten.');
  verify(app);
  return rollback(state, record, 'restored');
}
module.exports = { DEFAULT_STATE, PATCH_ID, PATCH_REVISION, MARKER, archivePath, fingerprint, same, saveJson,
  readJson, verify, version, marker, withLock, stage, swap, recover, install, restore, checkedRecord, recordPath };
