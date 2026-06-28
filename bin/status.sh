#!/usr/bin/env bash
# CLI snapshot from the xmrig API + the guard's current state.
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN="$(awk -F'"' '/access-token/{print $4}' "$LAB/config/xmrig.json" 2>/dev/null)"
PORT="$(awk -F'[: ,]+' '/"port"/{print $3; exit}' "$LAB/config/xmrig.json" 2>/dev/null)"
echo "guard: $(cat "$LAB/logs/state.txt" 2>/dev/null || echo 'not started')"
curl -s -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT:-18000}/2/summary" \
  | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); h=d.get("hashrate",{}).get("total",[0]); r=d.get("results",{})
 print(f"hashrate: {h[0] or 0:.1f} H/s (10s) | shares: {r.get(\"shares_good\",0)}/{r.get(\"shares_total\",0)}")
except Exception: print("miner not responding (paused or not started)")'
