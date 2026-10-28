#!/usr/bin/env bash
# Resumo compacto do repositório e do Orca para o coordenador.
# Uso: estado.sh [--relatorios]   (--relatorios lista os relatórios de hoje em cada worktree)
set -euo pipefail
O=${ORCA_CLI_COMMAND:-/home/cabeto/.config/orca/linux-orca-cli-shim/orca}
REPO=$(git rev-parse --show-toplevel)
BASE=${BASE_BRANCH:-develop}
today=$(date +%F)

echo "# worktrees (branch | ahead/behind $BASE | sujos | último commit)"
git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
  br=$(git -C "$wt" branch --show-current)
  ab=$(git -C "$wt" rev-list --left-right --count "$br...$BASE" 2>/dev/null | tr '\t' '/')
  dirty=$(git -C "$wt" status --porcelain | wc -l)
  echo "$br | $ab | $dirty | $(git -C "$wt" log -1 --format='%h %s' | cut -c1-70)"
  if [[ ${1:-} == --relatorios ]]; then
    find "$wt/docs/relatorios" -maxdepth 1 -name "$today*" -printf '    %p\n' 2>/dev/null
  fi
done

echo "# stashes: $(git -C "$REPO" stash list | wc -l)"
echo "# run atual"
"$O" orchestration run-current --json 2>/dev/null | python3 -c '
import json,sys
r=json.load(sys.stdin).get("result",{}).get("run") or {}
print(r.get("id"), "| coordenador:", r.get("coordinator_handle"), "| eu:", __import__("os").environ.get("ORCA_TERMINAL_HANDLE"))' || echo "Orca indisponível"
