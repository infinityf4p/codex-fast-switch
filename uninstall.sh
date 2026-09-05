#!/bin/sh
set -eu

fast_state="$HOME/Library/Application Support/Codex Fast Switch"
fast_app=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      printf '%s\n' 'Usage: sh uninstall.sh [--app /path/to/Codex.app] [--state /path/to/state]' \
        'Fully quit Codex with Command-Q first. Stops monitoring and restores the original app.' \
        'Keeps personal data, recovery records, and the local signing identity.'
      exit 0
      ;;
    --app|--state)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        printf 'Missing value for %s.\n' "$1" >&2
        exit 2
      fi
      case "$2" in --*) printf 'Missing value for %s.\n' "$1" >&2; exit 2 ;; esac
      if [ "$1" = --app ]; then fast_app="$2"; else fast_state="$2"; fi
      shift 2
      ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'Use uninstall.cmd on Windows. This script supports macOS only.' >&2
  exit 1
fi

# Use the matching installed CLI, including releases with the older directory layout.
fast_cli="$fast_state/agent/cli.cjs"
if [ ! -f "$fast_cli" ]; then
  fast_root="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
  fast_cli="$fast_root/cli.cjs"
fi
if [ ! -f "$fast_cli" ]; then
  printf '%s\n' 'No installed recovery program was found. Check --state, or run Restore Original App.command from the release ZIP.' \
    'Keep the original backup and signing files until restoration succeeds.' >&2
  exit 1
fi

fast_node=''
fast_system_node="$(command -v node || true)"
fast_app_node=''
if [ -n "$fast_app" ]; then fast_app_node="$fast_app/Contents/Resources/cua_node/bin/node"; fi
for fast_candidate in \
  "$fast_state/agent/runtime/node" \
  "$fast_app_node" \
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
  printf '%s\n' 'Node.js 22.12+ was not found. Install a suitable Node runtime and retry.' >&2
  exit 1
fi

printf '%s\n' 'Stopping automatic patching and restoring the original app...'
set -- "$fast_cli" restore --state "$fast_state"
if [ -n "$fast_app" ]; then set -- "$@" --app "$fast_app"; fi
"$fast_node" - "$@" <<'NODE'
const path = require('node:path');
const [cli, ...args] = process.argv.slice(2);
Promise.resolve().then(() => require(path.resolve(cli)).main(args)).then(result => {
  if (result) console.log(JSON.stringify(result, null, 2));
  if (result?.status === 'busy') throw new Error('Another patch operation is active. Wait for it to finish, then retry uninstall.');
  if (!['restored', 'already-restored', 'already-original', 'rolled-back', 'aborted'].includes(result?.status)) {
    throw new Error('Restoration did not report success. Keep the backup and check the result above.');
  }
}).catch(error => {
  console.error(`Uninstall failed: ${error.message}`);
  process.exitCode = 1;
});
NODE
printf '%s\n' 'Fast patch removed. You can reopen Codex using its usual icon.' \
  'Personal data, recovery records, and the local signing identity have been kept.'
