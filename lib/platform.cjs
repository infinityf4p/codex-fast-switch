const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function requireMac() {
  if (process.platform !== 'darwin') throw new Error('App patching and automatic monitoring currently support macOS only.');
}
function metadata(app) {
  requireMac();
  const plist = path.join(app, 'Contents/Info.plist');
  const read = key => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (read('CFBundleIdentifier') !== 'com.openai.codex') throw new Error('The selected app is not the Codex desktop bundle (com.openai.codex).');
  const executable = read('CFBundleExecutable');
  if (!executable || executable === '.' || executable === '..' || path.basename(executable) !== executable) throw new Error('Invalid bundle executable.');
  return { executable };
}
function discoverApp(explicit) {
  requireMac();
  if (explicit) {
    const app = fs.realpathSync(path.resolve(explicit));
    metadata(app);
    return app;
  }
  const candidates = [];
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    for (const name of ['Codex.app', 'ChatGPT.app']) {
      const app = path.join(dir, name);
      if (!fs.existsSync(app)) continue;
      try { metadata(app); candidates.push(fs.realpathSync(app)); } catch {}
    }
  }
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) throw new Error('Specify the Codex desktop bundle with --app "/path/to/Codex.app".');
  return unique[0];
}
const binaryPath = app => path.join(app, 'Contents/MacOS', metadata(app).executable);
const identityFiles = app => ['Contents/Info.plist', `Contents/MacOS/${metadata(app).executable}`,
  'Contents/_CodeSignature/CodeResources', 'Contents/Resources/app.asar'];
function assertStopped(app) {
  const binary = binaryPath(app);
  const output = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' });
  if (output.split('\n').some(line => line.trim() === binary || line.trim().startsWith(binary + ' '))) {
    throw Object.assign(new Error('The selected app is running. Fully quit it with Command-Q before applying or restoring the patch.'), { code: 'APP_RUNNING' });
  }
}
function assertRuntime(node) {
  const version = execFileSync(node, ['--version'], { encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/bin:/bin' } }).trim();
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 12))) throw new Error('Node.js 22.12 or newer is required.');
  return node;
}
module.exports = { requireMac, metadata, discoverApp, binaryPath, identityFiles, assertStopped, assertRuntime };
