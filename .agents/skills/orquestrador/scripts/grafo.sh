#!/usr/bin/env bash
# Graphify local code-only, cache fora do checkout.
# Uso: grafo.sh <web|api> extract [raiz-worktree]
#      grafo.sh <web|api> query "pergunta" [orçamento]
#      grafo.sh <web|api> explain "Símbolo" | path "A" "B"
set -euo pipefail
[[ $# -ge 2 ]] || { sed -n 3,5p "$0"; exit 2; }
area=$1 cmd=$2; shift 2
case $area in web|api) ;; *) echo "área: web ou api"; exit 2;; esac
out="$HOME/.cache/miupy-notes/graphify/$area"
graph="$out/graphify-out/graph.json"
export GRAPHIFY_QUERY_LOG_DISABLE=1
case $cmd in
  extract) root=${1:-$(git rev-parse --show-toplevel)}
           graphify extract "$root/apps/$area/src" --code-only --no-cluster --out "$out" | tail -3 ;;
  query)   [[ -f $graph ]] || { echo "sem grafo: rode '$0 $area extract'"; exit 1; }
           graphify query "$1" --graph "$graph" --budget "${2:-800}" ;;
  explain) graphify explain "$1" --graph "$graph" | head -40 ;;
  path)    graphify path "$1" "$2" --graph "$graph" ;;
  *) echo "comando: extract|query|explain|path"; exit 2 ;;
esac
