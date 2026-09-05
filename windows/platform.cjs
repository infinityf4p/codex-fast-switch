const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { sha256 } = require('../lib/archive.cjs');

const DEFAULT_STATE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Codex Fast Switch');
const nativeScript = path.join(__dirname, 'native.ps1');
function requireWindows() {
  if (process.platform !== 'win32') throw new Error('This command requires Windows.');
}
function native(action, data = {}, { env = process.env } = {}) {
  requireWindows();
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  let result;
  try {
    result = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', nativeScript, '-Action', action, '-Payload', Buffer.from(JSON.stringify(data)).toString('base64')],
    { encoding: 'utf8', env, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: 'pipe' }).trim();
  } catch (error) {
    let detail;
    try { detail = JSON.parse(String(error.stdout || '').replace(/^\uFEFF/, '')); } catch {}
    if (detail?.error?.message) throw Object.assign(new Error(detail.error.message), { code: detail.error.code });
    throw error;
  }
  return result ? JSON.parse(result.replace(/^\uFEFF/, '')) : null;
}
const archivePath = app => path.join(app, 'resources/app.asar');
function metadata(app) {
  asar.uncacheAll();
  const pkg = JSON.parse(asar.extractFile(archivePath(app), 'package.json'));
  if (pkg.name !== 'openai-codex-electron' || pkg.codexWindowsPackageIdentity !== 'OpenAI.Codex' ||
      pkg.codexWindowsPackagePublisher !== 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B' || pkg.codexBuildFlavor !== 'prod') {
    throw new Error('The selected app is not a production Windows Codex desktop app.');
  }
  const runtimeFile = path.join(app, 'owl-shell-runtime.json');
  if (!fs.existsSync(runtimeFile) || !fs.existsSync(path.join(app, 'resources/owl-app.ini'))) {
    throw new Error('This Windows release supports the Owl desktop runtime only. This app layout is unverified.');
  }
  const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
  if (runtime.schemaVersion !== 1 || runtime.platform !== 'win32' || !['x64', 'arm64'].includes(runtime.arch) ||
      !Array.isArray(runtime.msixPackageDependencies) || runtime.msixPackageDependencies.length) {
    throw new Error('Unsupported Windows runtime or external MSIX dependencies.');
  }
  for (const file of ['ChatGPT.exe', 'chrome.dll', 'resources/codex.exe']) {
    if (!fs.statSync(path.join(app, file)).isFile()) throw new Error(`Missing runtime file: ${file}`);
  }
  return { version: pkg.version, build: String(pkg.codexBuildNumber), arch: runtime.arch, executable: 'ChatGPT.exe' };
}
function normalizeApp(explicit) {
  let app = fs.realpathSync(path.resolve(explicit));
  if (fs.statSync(app).isFile()) app = path.dirname(app);
  if (!fs.existsSync(archivePath(app)) && fs.existsSync(archivePath(path.join(app, 'app')))) app = path.join(app, 'app');
  metadata(app);
  return fs.realpathSync(app);
}
function discoverApp(explicit) {
  if (explicit) return normalizeApp(explicit);
  const packages = native('discover');
  if (packages?.length) return normalizeApp(packages[0].app);
  const candidates = [path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs/Codex'),
    path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs/ChatGPT')];
  const apps = candidates.filter(app => fs.existsSync(archivePath(app))).map(normalizeApp);
  if (apps.length !== 1) throw new Error('Codex was not found. Use --app "C:\\path\\to\\Codex\\app" (or select ChatGPT.exe).');
  return apps[0];
}
const binaryPath = app => path.join(app, 'ChatGPT.exe');
const identityFiles = () => ['ChatGPT.exe', 'chrome.dll', 'resources/codex.exe', 'resources/app.asar',
  'owl-shell-runtime.json', 'resources/owl-app.ini'];
const fingerprint = app => Object.fromEntries(identityFiles().map(file => [file, sha256(fs.readFileSync(path.join(app, file)))]));
function same(app, expected) {
  try { return JSON.stringify(fingerprint(app)) === JSON.stringify(expected); } catch { return false; }
}
function verify(app, { patched = false } = {}) {
  const info = metadata(app);
  const files = ['ChatGPT.exe', 'chrome.dll', 'resources/codex.exe'].map(file => path.join(app, file));
  const signatures = native('signature', { files });
  if (!Array.isArray(signatures) || signatures.length !== files.length || signatures.some((signature, index) =>
    signature.file !== files[index] || (patched && index === 0 ? signature.status !== 'NotSigned' :
      signature.status !== 'Valid' || !/(?:^|,\s*)O="?OpenAI OpCo, LLC"?(?:,|$)/.test(signature.subject || '')))) {
    throw new Error('The Windows runtime must have valid OpenAI Authenticode signatures.');
  }
  require('./integrity.cjs').verify(app);
  return info;
}
function processPaths(apps) {
  return [...new Set(apps.filter(Boolean).map(binaryPath))];
}
function processes(apps) {
  const binaries = processPaths(apps).map(file => file.toLowerCase());
  return native('processes', { binaries: processPaths(apps) }).map(item => {
    try { return { ...item, nativePath: item.path, path: fs.realpathSync(item.path) }; }
    catch { throw new Error(`Cannot resolve the executable path of PID ${item.pid}. Close Codex and retry.`); }
  }).filter(item => binaries.includes(item.path.toLowerCase()));
}
function assertStopped(apps) {
  if (processes(apps).length) throw Object.assign(new Error('Codex is running. Exit it from its menu or system tray, then retry.'), { code: 'APP_RUNNING' });
}
const requestQuit = apps => native('quit', { binaries: [...new Set(processes(apps).map(item => item.nativePath))] });
const openApp = app => native('open', { binary: binaryPath(app) });
function assertRuntime(node) {
  const result = execFileSync(node, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  const [major, minor] = result.replace(/^v/, '').split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 12))) throw new Error('Node.js 22.12 or newer is required.');
  return node;
}
module.exports = { DEFAULT_STATE, nativeScript, native, requireWindows, metadata, normalizeApp, discoverApp, archivePath,
  binaryPath, identityFiles, fingerprint, same, verify, processes, assertStopped, requestQuit, openApp, assertRuntime };
