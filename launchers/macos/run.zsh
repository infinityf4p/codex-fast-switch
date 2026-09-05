#!/bin/zsh
set -eu
fast_root="${0:A:h:h:h}"
fast_node=""
fast_candidates=(
  "$HOME/Library/Application Support/Codex Fast Switch/agent/runtime/node"
  /Applications/Codex.app/Contents/Resources/cua_node/bin/node
  /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
  "$HOME/Applications/Codex.app/Contents/Resources/cua_node/bin/node"
  "$HOME/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
)
if command -v node >/dev/null 2>&1; then fast_candidates+=("$(command -v node)"); fi
for fast_candidate in "${fast_candidates[@]}"; do
  if [[ -x "$fast_candidate" ]] && "$fast_candidate" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' >/dev/null 2>&1; then
    fast_node="$fast_candidate"
    break
  fi
done
fast_result=1
if [[ -z "$fast_node" ]]; then
  print 'Node.js 22.12 or newer was not found. Install Node.js or use the CLI with the runtime from your app.'
elif "$fast_node" "$fast_root/cli.cjs" "$@"; then
  fast_result=0
fi
read -r 'fast_done?Press Return to close.'
exit "$fast_result"
