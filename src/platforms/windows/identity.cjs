const fs = require('node:fs');
const path = require('node:path');
const { native } = require('./platform.cjs');

// The Owl runtime resolves its package identity through the AppModel runtime API
// set and refuses to start when the process has none. A local copy started by
// path therefore dies with "The process has no package identity.", so every
// generation of the patched copy is registered as its own local package and is
// opened through that identity instead of by executable path.
const PACKAGE_NAME = 'CodexFast.Switch';
const PUBLISHER = 'CN=CodexFastLocal';
const PACKAGE_VERSION = '1.0.0.0';
const APP_ID = 'App';
const APP_DIRECTORY = 'app';
const EXECUTABLE = 'ChatGPT.exe';
const IMAGES = ['icon.png', 'Square44x44Logo.png', 'Square150x150Logo.png'];
const assetsPath = source => path.join(path.dirname(source), 'assets');

function manifest(arch) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
  IgnorableNamespaces="uap rescap desktop6">
  <Identity Name="${PACKAGE_NAME}" Publisher="${PUBLISHER}" Version="${PACKAGE_VERSION}" ProcessorArchitecture="${arch}" />
  <Properties>
    <DisplayName>Codex Fast</DisplayName>
    <PublisherDisplayName>Codex Fast Switch</PublisherDisplayName>
    <Logo>assets\\icon.png</Logo>
    <desktop6:RegistryWriteVirtualization>disabled</desktop6:RegistryWriteVirtualization>
    <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-US" />
  </Resources>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
    <Capability Name="internetClient" />
  </Capabilities>
  <Applications>
    <Application Id="${APP_ID}" Executable="${APP_DIRECTORY}\\${EXECUTABLE}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Codex Fast" Description="Codex Fast" Square44x44Logo="assets\\Square44x44Logo.png" Square150x150Logo="assets\\Square150x150Logo.png" BackgroundColor="#3143FF" />
    </Application>
  </Applications>
</Package>
`;
}
function architecture(app) {
  try {
    const runtime = JSON.parse(fs.readFileSync(path.join(app, 'owl-shell-runtime.json'), 'utf8'));
    if (runtime.arch === 'arm64') return 'arm64';
  } catch {}
  return 'x64';
}
function describe(record) {
  return { packageFullName: record.packageFullName, packageFamilyName: record.packageFamilyName,
    installLocation: record.installLocation, appId: APP_ID, activation: record.packageFamilyName + '!' + APP_ID };
}
function info(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function writeChanged(file, bytes) {
  const existing = info(file);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('The local package resource is redirected.');
    if (fs.readFileSync(file).equals(bytes)) return false;
  }
  // Read/write bytes rather than CopyFile: official MSIX files may carry
  // encrypted attributes that prevent CopyFile from copying their content.
  fs.writeFileSync(file, bytes);
  return true;
}

function prepareImages(root, source) {
  const index = require('./package-icons.json');
  if (index.packageName !== PACKAGE_NAME || !index.assets.every(name => /^[A-Za-z0-9_.-]+\.png$/.test(name))) {
    throw new Error('Invalid local package icon index.');
  }
  const assets = path.join(root, 'assets');
  const existing = info(assets), original = info(assetsPath(source));
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) throw new Error('The local package assets are redirected.');
  if (!original || original.isSymbolicLink() || !original.isDirectory()) throw new Error('The official package assets are missing or redirected.');
  fs.mkdirSync(assets, { recursive: true });
  for (const name of IMAGES) {
    const origin = path.join(assetsPath(source), name);
    if (!fs.existsSync(origin)) throw new Error(`The official package is missing assets/${name}; the local identity cannot be prepared.`);
  }
  let changed = false;
  const available = new Set(fs.readdirSync(assetsPath(source)).filter(name =>
    /^(?:icon|Square44x44Logo|Square150x150Logo)(?:\.[A-Za-z0-9_-]+)?\.png$/.test(name)));
  for (const name of available) {
    const origin = path.join(assetsPath(source), name), entry = info(origin);
    if (!entry || entry.isSymbolicLink() || !entry.isFile()) throw new Error('The official package resource is redirected.');
    changed = writeChanged(path.join(assets, name), fs.readFileSync(origin)) || changed;
  }
  const template = fs.readFileSync(path.join(__dirname, 'package-icons.pri'));
  const pri = path.join(root, 'resources.pri');
  const indexed = index.assets.every(name => available.has(name));
  if (indexed) changed = writeChanged(pri, template) || changed;
  else if (info(pri)) {
    if (info(pri).isSymbolicLink() || !info(pri).isFile()) throw new Error('The local package icon index is redirected.');
    // An incompatible future asset layout keeps the basic official logos.
    // Remove only our own index so it cannot select a missing image.
    if (fs.readFileSync(pri).equals(template)) { fs.unlinkSync(pri); changed = true; }
  }
  return { changed, indexed };
}
function ensure(app, source, { run = native } = {}) {
  const root = path.dirname(app);
  const pendingPath = path.join(root, '.identity-refresh-pending');
  const pending = info(pendingPath);
  if (pending && (pending.isSymbolicLink() || !pending.isFile())) throw new Error('The local package refresh marker is redirected.');
  const manifestPath = path.join(root, 'AppxManifest.xml');
  const xml = manifest(architecture(app));
  const manifestChanged = writeChanged(manifestPath, Buffer.from(xml));
  const icons = prepareImages(root, source);
  const refresh = !!pending || manifestChanged || icons.changed;
  // Persist before registration: if it fails, identical resource bytes on the
  // next attempt must not hide the outstanding Shell registration refresh.
  if (refresh) writeChanged(pendingPath, Buffer.from(`${PACKAGE_NAME}\n`));
  const record = run('identity', { name: PACKAGE_NAME, version: PACKAGE_VERSION, root, refresh });
  if (!record?.packageFamilyName) throw new Error('The local package identity was not registered.');
  if (refresh) {
    const current = info(pendingPath);
    if (current && (current.isSymbolicLink() || !current.isFile())) throw new Error('The local package refresh marker is redirected.');
    if (current) fs.unlinkSync(pendingPath);
  }
  return { ...describe(record), indexedIcons: icons.indexed };
}
function registerExisting(app, { run = native } = {}) {
  // Rollback must use the retained generation's resources: the Store may have
  // already removed its original source directory during an official update.
  return run('identity', { name: PACKAGE_NAME, version: PACKAGE_VERSION, root: path.dirname(app), refresh: false });
}
function remove(prepared, { run = native } = {}) {
  if (!prepared.roots.length) return { status: 'not-registered', removed: [] };
  return run('remove-identity', { state: prepared.state, roots: prepared.roots });
}
module.exports = { PACKAGE_NAME, PACKAGE_VERSION, APP_ID, manifest, architecture, prepareImages, ensure, registerExisting, remove };
