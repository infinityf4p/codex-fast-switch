const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const signing = require('./signing.cjs');
const { binaryPath } = require('./platform.cjs');
const { readJson, saveJson } = require('../../core/state.cjs');

const HELPER_REVISION = 1;
const IDENTIFIER = 'io.github.infinityf4p.codex-fast-switch.storage-access';
const BRIDGE = '@executable_path/../Resources/cfs-storage.dylib';
const recordPath = state => path.join(state, 'storage-helper.json');
const helperPath = state => path.join(state, 'storage', 'Codex Storage Access.app');
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const build = path.join(__dirname, '../../../build/macos');
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe' });

function writePlist(file, value) {
  saveJson(file, value);
  run('/usr/bin/plutil', ['-convert', 'xml1', file]);
}

function configuration(state) {
  return fs.existsSync(recordPath(state)) ? readJson(recordPath(state)) : null;
}

function matchesMarker(state, app, marker) {
  const record = configuration(state);
  if (!record?.enabled) return !marker?.storageHelper;
  return record.app === fs.realpathSync(app) && record.revision === marker?.storageHelper?.revision &&
    record.certificateSha256 === marker.storageHelper.certificateSha256;
}

function checkedHelper(state, app) {
  const record = configuration(state);
  if (!record?.enabled) return null;
  if (record.schema !== 1 || record.revision !== HELPER_REVISION || record.app !== fs.realpathSync(app) ||
      record.bundle !== helperPath(state) || !/^[a-f0-9]{64}$/.test(record.certificateSha256 || '')) {
    throw new Error('The persistent Storage helper configuration is invalid.');
  }
  const identity = signing.readIdentity(state);
  if (record.certificateSha256 !== identity.certificateSha256) throw new Error('The Storage helper signing identity changed.');
  for (const [file, digest] of Object.entries(record.files || {})) {
    if (!['Contents/MacOS/storage-access', 'Contents/Info.plist', 'Contents/Resources/storage-access.plist',
      'Contents/_CodeSignature/CodeResources'].includes(file) || hashFile(path.join(record.bundle, file)) !== digest) {
      throw new Error('The persistent Storage helper has changed.');
    }
  }
  if (Object.keys(record.files || {}).length !== 4) throw new Error('The Storage helper integrity record is incomplete.');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${signing.requirementFor(IDENTIFIER, identity.certificateSha1)}`, record.bundle]);
  return record;
}

function enable(state, app, { service = 'Codex Storage Key', account = 'Codex', keychain, allowInteraction = true } = {}) {
  state = path.resolve(state);
  app = fs.realpathSync(app);
  const previous = configuration(state);
  if (previous?.enabled) return checkedHelper(state, app);
  if (previous || fs.existsSync(helperPath(state))) throw new Error('An existing Storage helper needs explicit recovery; it was not replaced.');
  const identity = signing.ensureIdentity(state);
  const directory = path.join(state, 'storage');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(directory, '.prepare-'));
  const staged = path.join(temporary, 'Codex Storage Access.app');
  try {
    fs.mkdirSync(path.join(staged, 'Contents/MacOS'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(staged, 'Contents/Resources'), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(build, 'storage-access'), path.join(staged, 'Contents/MacOS/storage-access'));
    fs.chmodSync(path.join(staged, 'Contents/MacOS/storage-access'), 0o700);
    writePlist(path.join(staged, 'Contents/Info.plist'), { CFBundleIdentifier: IDENTIFIER,
      CFBundleExecutable: 'storage-access', CFBundleName: 'Codex Storage Access', CFBundlePackageType: 'APPL',
      CFBundleVersion: String(HELPER_REVISION), LSUIElement: true, LSMinimumSystemVersion: '13.0' });
    writePlist(path.join(staged, 'Contents/Resources/storage-access.plist'), { schema: 1, app,
      clientRequirement: signing.requirementFor('com.openai.codex', identity.certificateSha1),
      service, account, ...(keychain ? { keychain: path.resolve(keychain) } : {}), allowInteraction });
    signing.sign(staged, state, { identifier: IDENTIFIER, expectedCertificateSha256: identity.certificateSha256 });
    const files = Object.fromEntries(['Contents/MacOS/storage-access', 'Contents/Info.plist',
      'Contents/Resources/storage-access.plist', 'Contents/_CodeSignature/CodeResources'].map(file => [file, hashFile(path.join(staged, file))]));
    const record = { schema: 1, enabled: true, revision: HELPER_REVISION, app, bundle: helperPath(state),
      certificateSha256: identity.certificateSha256, files, createdAt: new Date().toISOString() };
    fs.renameSync(staged, record.bundle);
    saveJson(recordPath(state), record);
    return record;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function copyBridge(destination, app, state, { denyOtherKeychainReads = false } = {}) {
  const record = checkedHelper(state, app);
  if (!record) return null;
  const identity = signing.readIdentity(state);
  const binary = binaryPath(destination);
  const dependencies = run('/usr/bin/otool', ['-L', binary]);
  if (!/^\s+\/usr\/lib\/libSystem\.B\.dylib \(/m.test(dependencies) || dependencies.includes(BRIDGE)) {
    throw new Error('Cannot recognize the app bootstrap library dependency.');
  }
  const library = path.join(destination, 'Contents/Resources/cfs-storage.dylib');
  fs.copyFileSync(path.join(build, 'cfs-storage.dylib'), library);
  writePlist(path.join(destination, 'Contents/Resources/codex-fast-storage.plist'), {
    schema: 1, helper: record.bundle, helperRequirement: signing.requirementFor(IDENTIFIER, identity.certificateSha1),
    statusPath: path.join(state, 'storage-status.json'), denyOtherKeychainReads,
  });
  // The bridge re-exports libSystem unchanged and loads before Owl initializes encrypted storage.
  run('/usr/bin/install_name_tool', ['-change', '/usr/lib/libSystem.B.dylib', BRIDGE, binary]);
  if (!run('/usr/bin/otool', ['-L', binary]).includes(BRIDGE)) throw new Error('Storage bridge was not linked.');
  return { revision: HELPER_REVISION, certificateSha256: record.certificateSha256 };
}

module.exports = { HELPER_REVISION, IDENTIFIER, BRIDGE, recordPath, helperPath, configuration, matchesMarker, checkedHelper, enable, copyBridge };
