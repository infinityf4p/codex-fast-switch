#!/bin/sh
set -eu

if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'Codex Fast Switch currently supports macOS only.' >&2
  exit 1
fi
if [ "${1:-}" = --help ]; then
  printf '%s\n' 'Usage: sh install.sh [--app /path/to/Codex.app] [--state /path/to/state]'
  exit 0
fi

fast_node=''
fast_system_node="$(command -v node || true)"
for fast_candidate in \
  "$HOME/Library/Application Support/Codex Fast Switch/agent/runtime/node" \
  /Applications/Codex.app/Contents/Resources/cua_node/bin/node \
  /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node \
  "$HOME/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
  "$HOME/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "$fast_system_node"
do
  if [ -x "$fast_candidate" ] && "$fast_candidate" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' >/dev/null 2>&1; then
    fast_node="$fast_candidate"
    break
  fi
done
if [ -z "$fast_node" ]; then
  printf '%s\n' 'Node.js 22.12+ was not found. Install Codex first, or install a suitable Node runtime.' >&2
  exit 1
fi

fast_tmp="$(mktemp -d "${TMPDIR:-/tmp}/codex-fast-install.XXXXXX")"
trap 'rm -rf "$fast_tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

"$fast_node" - "$fast_tmp" "$@" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [temporary, ...options] = process.argv.slice(2);
const base = 'https://infinityf4p.github.io/codex-fast-switch/';

function download(url, destination) {
  execFileSync('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--location',
    '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '180',
    '--retry', '2', '--header', 'Cache-Control: no-cache', '--output', destination, url], { stdio: 'inherit' });
}
try {
  const metadata = path.join(temporary, 'latest.json');
  const archive = path.join(temporary, 'package.zip');
  let latest, asset;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      console.log('Checking the latest tested Codex Fast Switch build...');
      download(base + 'latest.json?check=' + crypto.randomUUID(), metadata);
      latest = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      if (latest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(latest.commit) || !/^\d+\.\d+\.\d+$/.test(latest.version)) {
        throw new Error('Invalid update metadata.');
      }
      asset = latest.assets?.darwin;
      const directory = `codex-fast-switch-${latest.version}-macos-universal`;
      if (asset?.url !== `${base}${latest.commit}/${directory}.zip` || asset.directory !== directory ||
          !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 134217728) {
        throw new Error('The update has an unexpected download URL or checksum.');
      }
      console.log(`Latest build: ${latest.commit.slice(0, 12)}`);
      const stateIndex = options.indexOf('--state');
      const state = stateIndex >= 0 ? options[stateIndex + 1] : path.join(require('node:os').homedir(), 'Library/Application Support/Codex Fast Switch');
      try {
        const installed = JSON.parse(fs.readFileSync(path.join(state, 'agent/build-info.json'), 'utf8'));
        if (installed.commit === latest.commit) console.log('This build is already installed. Checking and repairing the installation...');
        else if (/^[a-f0-9]{40}$/.test(installed.commit)) console.log(`Updating from: ${installed.commit.slice(0, 12)}`);
      } catch {}
      download(asset.url, archive);
      const bytes = fs.readFileSync(archive);
      if (bytes.length !== asset.size || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
        throw new Error('The downloaded package failed its SHA-256 check.');
      }
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      console.log('Retrying with fresh update metadata...');
    }
  }
  const entries = execFileSync('/usr/bin/unzip', ['-Z', '-1', archive], { encoding: 'utf8' }).trim().split('\n');
  if (entries.some(entry => entry !== asset.directory + '/' &&
      (!entry.startsWith(asset.directory + '/') || entry.split('/').some(part => part === '..' || part === '.') || entry.includes('\\')))) {
    throw new Error('The downloaded package contains an unexpected path.');
  }
  const unpacked = path.join(temporary, 'unpacked');
  fs.mkdirSync(unpacked);
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, unpacked], { stdio: 'inherit' });
  const directory = path.join(unpacked, asset.directory);
  if (JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8')).commit !== latest.commit) {
    throw new Error('The downloaded package belongs to a different build.');
  }
  execFileSync(process.execPath, [path.join(directory, 'cli.cjs'), 'setup', ...options], { stdio: 'inherit' });
  console.log('Codex Fast Switch is ready.');
} catch (error) {
  console.error(`Installation failed: ${error.message}`);
  process.exitCode = 1;
}
NODE
