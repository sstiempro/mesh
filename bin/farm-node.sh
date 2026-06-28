#!/usr/bin/env bash
# Mesh farming helper — the automatable slice of thin-air farming.
# HONEST: airdrop/DePIN nodes are anti-bot BY DESIGN (sybil resistance). True headless automation
# defeats the point and gets you filtered. So this onboards + launches the mesh-runnable targets;
# YOU authenticate, hold keys, and claim. The mesh's real edge = running these on BOTH Macs.
#
#   bash bin/farm-node.sh list          # mesh-runnable targets, EV-ranked
#   bash bin/farm-node.sh open          # open every mesh-runnable target's page to set up
#   bash bin/farm-node.sh open <id>     # open one target
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
REG="$LAB/config/farm-targets.json"
CMD="${1:-list}"; ID="${2:-}"

mesh_targets() {  # id|name|url for mesh:true with a url
  python3 - "$REG" <<'PY'
import json,sys
reg=json.load(open(sys.argv[1]))
for t in reg.get("targets",[]):
    if t.get("mesh") and t.get("url"):
        print(f"{t['id']}|{t['name']}|{t['url']}|{t.get('cat')}|{t.get('est_low')}-{t.get('est_high')}")
PY
}

case "$CMD" in
  list)
    echo "Mesh-runnable farming targets (run on BOTH Macs for more nodes/points):"
    mesh_targets | while IFS='|' read -r id name url cat ev; do printf "  %-22s %-28s [%s] \$%s\n" "$id" "$name" "$cat" "$ev"; done
    echo ""
    echo "Run 'bash bin/farm-node.sh open' to open them all for signup/install."
    ;;
  open)
    n=0
    mesh_targets | while IFS='|' read -r id name url cat ev; do
      if [ -n "$ID" ] && [ "$ID" != "$id" ]; then continue; fi
      echo "→ $name  $url"; open "$url" 2>/dev/null || echo "  (open manually: $url)"; n=$((n+1)); sleep 0.4
    done
    echo "Opened mesh targets. Sign up / install the extension on EACH Mac, then mark them 'active' on the Farm page."
    ;;
  *) echo "usage: farm-node.sh [list|open] [id]"; exit 1;;
esac
