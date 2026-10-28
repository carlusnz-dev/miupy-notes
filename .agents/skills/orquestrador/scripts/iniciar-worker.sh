#!/usr/bin/env bash
# Inicia um worker com spec padrão apontando para os briefs.
# Uso: iniciar-worker.sh <run> <worktree> <claude|codex> <modelo> <low|medium|high> <frente> "<título>" [pasta-briefs]
set -euo pipefail
[[ $# -ge 7 ]] || { sed -n 3p "$0"; exit 2; }
O=${ORCA_CLI_COMMAND:-/home/cabeto/.config/orca/linux-orca-cli-shim/orca}
run=$1 wt=$2 agent=$3 model=$4 effort=$5 front=$6 title=$7
B=${8:-${BRIEFS:?defina BRIEFS ou passe a pasta de briefs}}
[[ -f $B/comum.md && -f $B/frente-$front.md ]] || { echo "brief ausente em $B"; exit 1; }
"$O" orchestration worker-start --run "$run" --worktree "name:$wt" --agent "$agent" \
  --model "$model" --effort "$effort" --task-title "$title" \
  --spec "Leia $B/comum.md e $B/frente-$front.md e execute a frente $front. Entregue $B/resultado-$front.md e avise o coordenador." \
  --json | python3 -c '
import json,sys
d=json.load(sys.stdin); r=d.get("result",{})
print("ok" if d.get("ok") else "FALHOU", r.get("dispatchId"), r.get("stage"), d.get("error",{}).get("message",""))'
