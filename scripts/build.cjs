const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { requireMac } = require('../lib/platform.cjs');
if (process.platform === 'win32') {
  execFileSync(process.execPath, [path.join(__dirname, 'check.cjs')], { stdio: 'inherit' });
  console.log('Windows scripts are ready; no compiler is required.');
  process.exit(0);
}
requireMac();
const root = path.join(__dirname, '..');
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-framework', 'AppKit', path.join(root, 'lib/native.m'), '-o', path.join(root, 'lib/native-helper')], { stdio: 'inherit' });
fs.chmodSync(path.join(root, 'lib/native-helper'), 0o755);
execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-fobjc-arc', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security',
  path.join(root, 'lib/signing-native.m'), '-o', path.join(root, 'lib/signing-helper')], { stdio: 'inherit' });
fs.chmodSync(path.join(root, 'lib/signing-helper'), 0o755);
for (const file of fs.readdirSync(root).filter(file => file.endsWith('.command'))) fs.chmodSync(path.join(root, file), 0o755);
fs.chmodSync(path.join(root, 'bin/run.zsh'), 0o755);
console.log('Built universal macOS helper (arm64 + x86_64).');
