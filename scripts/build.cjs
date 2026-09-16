const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform === 'win32') {
  execFileSync(process.execPath, [path.join(__dirname, 'check.cjs')], { stdio: 'inherit' });
  console.log('Windows scripts are ready; no compiler is required.');
  process.exit(0);
}
require('../src/platforms/macos/platform.cjs').requireMac();
const root = path.join(__dirname, '..');
const build = path.join(root, 'build/macos');
fs.mkdirSync(build, { recursive: true });
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-framework', 'AppKit', path.join(root, 'src/platforms/macos/native.m'), '-o', path.join(build, 'native-helper')], { stdio: 'inherit' });
fs.chmodSync(path.join(build, 'native-helper'), 0o755);
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security',
  path.join(root, 'src/platforms/macos/signing-native.m'), '-o', path.join(build, 'signing-helper')], { stdio: 'inherit' });
fs.chmodSync(path.join(build, 'signing-helper'), 0o755);
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-dynamiclib', '-framework', 'Foundation',
  path.join(root, 'src/platforms/macos/update-hook.m'), '-o', path.join(build, 'codex-fast-update-hook.dylib')], { stdio: 'inherit' });
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security',
  path.join(root, 'src/platforms/macos/storage-access.m'), '-o', path.join(build, 'storage-access')], { stdio: 'inherit' });
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-Wno-deprecated-declarations', '-dynamiclib', '-framework', 'Foundation', '-framework', 'Security',
  '-Wl,-reexport-lSystem', '-Wl,-compatibility_version,1.0.0', '-Wl,-current_version,1356.0.0',
  '-Wl,-install_name,@executable_path/../Resources/cfs-storage.dylib',
  path.join(root, 'src/platforms/macos/storage-bridge.m'), '-o', path.join(build, 'cfs-storage.dylib')], { stdio: 'inherit' });
const launchers = path.join(root, 'launchers/macos');
for (const file of fs.readdirSync(launchers).filter(file => file.endsWith('.command') || file.endsWith('.zsh'))) {
  fs.chmodSync(path.join(launchers, file), 0o755);
}
console.log('Built universal macOS helper (arm64 + x86_64).');
