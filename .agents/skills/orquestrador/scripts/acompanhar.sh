#!/usr/bin/env bash
# Uma linha por dispatch e mensagens novas do Run (ignora heartbeat). Ids lidos ficam em $SEEN.
# Uso: acompanhar.sh <run> <dispatch...>
set -euo pipefail
[[ $# -ge 2 ]] || { sed -n 3p "$0"; exit 2; }
O=${ORCA_CLI_COMMAND:-/home/cabeto/.config/orca/linux-orca-cli-shim/orca}
run=$1; shift
SEEN=${SEEN:-${TMPDIR:-/tmp}/orca-seen-$run}; touch "$SEEN"
for d in "$@"; do
  "$O" orchestration worker-show --dispatch "$d" --json | python3 -c '
import json,sys
r=json.load(sys.stdin)["result"]; d=r["dispatch"]; w=r.get("worker") or {}
print(d["id"], d["status"], w.get("stage"), d.get("completedAt") or "", (d.get("lastFailure") or ""))'
done
"$O" orchestration check --terminal "$ORCA_TERMINAL_HANDLE" --json | SEEN="$SEEN" python3 -c '
import json,os,sys
seen=set(open(os.environ["SEEN"]).read().split())
msgs=json.load(sys.stdin)["result"].get("messages") or []
with open(os.environ["SEEN"],"a") as f:
  for m in msgs:
    if m.get("type")=="heartbeat" or m.get("id") in seen: continue
    f.write(m["id"]+"\n")
    print("MSG", m["id"], m.get("from_handle") or m.get("from"), m.get("type"), str(m.get("subject") or m.get("body") or "")[:200].replace("\n"," "))'
