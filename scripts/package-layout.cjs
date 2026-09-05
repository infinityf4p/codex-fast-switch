const fs = require('node:fs');
const path = require('node:path');
const { root, copyRuntime } = require('../src/core/runtime.cjs');

const documents = ['README.md', 'README.en.md', 'docs', 'SECURITY.md', 'CHANGELOG.md'];
const launchers = {
  darwin: ['install.sh', 'launchers/macos'],
  win32: ['install.cmd', 'uninstall.cmd', 'launchers/windows'],
};

function rejectSigningState(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'signing' || ['.pem', '.key', '.p12', '.pfx', '.keychain', '.keychain-db'].includes(path.extname(entry.name))) {
      throw new Error('Refusing to package local signing identity material.');
    }
    if (entry.isDirectory()) rejectSigningState(path.join(directory, entry.name));
  }
}

function stagePackage(name, platform) {
  if (!/^codex-fast-switch-[A-Za-z0-9._-]+$/.test(name) || !Object.hasOwn(launchers, platform)) {
    throw new Error('Invalid release package name or platform.');
  }
  const dist = path.resolve(root, 'dist');
  const stage = path.resolve(dist, name);
  if (path.dirname(stage) !== dist || (fs.existsSync(dist) && fs.lstatSync(dist).isSymbolicLink()) ||
      (fs.existsSync(stage) && fs.lstatSync(stage).isSymbolicLink())) {
    throw new Error('Release staging must stay inside the repository dist directory.');
  }
  for (const directory of ['src', 'build']) rejectSigningState(path.join(root, directory));
  // Recreate staging so removed source files cannot survive in a later release.
  fs.rmSync(stage, { recursive: true, force: true });
  copyRuntime(stage, platform);
  for (const file of [...documents, ...launchers[platform]]) {
    const target = path.join(stage, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, file), target, { recursive: true, verbatimSymlinks: true });
  }
  return { dist, stage };
}

module.exports = { stagePackage };
