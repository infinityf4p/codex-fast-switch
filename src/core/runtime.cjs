const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const common = ['cli.cjs', 'src/core', 'node_modules', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const platforms = {
  darwin: [
    ...['cli.cjs', 'automatic.cjs', 'watch.cjs', 'platform.cjs', 'transaction.cjs', 'restart.cjs', 'signing.cjs',
      'update-hook.cjs', 'relaunch.cjs', 'storage.cjs', 'local-entitlements.plist'].map(name => `src/platforms/macos/${name}`),
    'build/macos/native-helper', 'build/macos/signing-helper', 'build/macos/codex-fast-update-hook.dylib',
    'build/macos/storage-access', 'build/macos/cfs-storage.dylib',
  ],
  win32: ['src/platforms/windows'],
};

function runtimeFiles(platform = process.platform) {
  if (!Object.hasOwn(platforms, platform)) throw new Error(`Unsupported runtime platform: ${platform}`);
  return [...common, ...platforms[platform]];
}

function copyRuntime(destination, platform = process.platform) {
  const files = runtimeFiles(platform);
  fs.mkdirSync(destination, { recursive: true });
  if (fs.realpathSync(root) === fs.realpathSync(destination)) return;
  for (const file of files) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, file), target, { recursive: true, verbatimSymlinks: true });
  }
  const sourceBuild = path.join(root, 'build-info.json'), installedBuild = path.join(destination, 'build-info.json');
  if (fs.existsSync(sourceBuild)) fs.copyFileSync(sourceBuild, installedBuild);
  else if (fs.existsSync(installedBuild)) fs.unlinkSync(installedBuild);
}

module.exports = { root, runtimeFiles, copyRuntime };
