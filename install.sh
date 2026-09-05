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
const repository = 'infinityf4p/codex-fast-switch';

function download(url, destination) {
  execFileSync('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--location',
    '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '180',
    '--retry', '2', '--output', destination, url], { stdio: 'inherit' });
}
try {
  console.log('Finding the latest Codex Fast Switch release...');
  const metadata = path.join(temporary, 'release.json');
  download(`https://api.github.com/repos/${repository}/releases/latest`, metadata);
  const release = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  const assets = release.assets?.filter(asset => /^codex-fast-switch-\d+\.\d+\.\d+-macos-universal\.zip$/.test(asset.name));
  if (release.draft || release.prerelease || assets?.length !== 1) throw new Error('A stable macOS release package was not found.');
  const asset = assets[0];
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${repository}/releases/download/`)) {
    throw new Error('The release has an unexpected download URL.');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error('The release is missing its SHA-256 digest.');
  const archive = path.join(temporary, asset.name);
  console.log(`Downloading ${release.tag_name}...`);
  download(url.href, archive);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (digest !== asset.digest.slice(7)) throw new Error('The downloaded package failed its SHA-256 check.');
  const unpacked = path.join(temporary, 'unpacked');
  fs.mkdirSync(unpacked);
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, unpacked], { stdio: 'inherit' });
  const directory = path.join(unpacked, asset.name.slice(0, -4));
  execFileSync(process.execPath, [path.join(directory, 'cli.cjs'), 'setup', ...options], { stdio: 'inherit' });
  console.log('Codex Fast Switch is ready.');
} catch (error) {
  console.error(`Installation failed: ${error.message}`);
  process.exitCode = 1;
}
NODE
