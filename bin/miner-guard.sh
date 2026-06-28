#!/usr/bin/env bash
# The brain: mine ONLY when on AC + idle + not thermally throttling. Pause otherwise.
# No sudo needed — thermal state comes from `pmset -g therm`.
set -uo pipefail
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XMRIG="$LAB/engine/xmrig/build/xmrig"
CONFIG="$LAB/config/xmrig.json"
LOG="$LAB/logs/xmrig.log"
STATE="$LAB/logs/state.txt"
STOP_FLAG="$LAB/STOP"
IDLE_THRESHOLD="${IDLE_THRESHOLD:-120}"   # seconds of no keyboard/mouse before mining
INTERVAL="${INTERVAL:-20}"                # how often to re-check conditions
REQUIRE_AC="${REQUIRE_AC:-1}"             # 1 = only mine on AC power
mkdir -p "$LAB/logs"

[ -x "$XMRIG" ] || { echo "xmrig not built — run ./bin/setup.sh first"; exit 1; }
grep -q "REPLACE_WITH_YOUR" "$CONFIG" 2>/dev/null && {
  echo "Set your wallet address in config/xmrig.json before starting."; exit 1; }

is_ac()        { pmset -g batt | grep -q "'AC Power'"; }
idle_secs()    { ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'; }
thermal_ok()   { local l; l=$(pmset -g therm 2>/dev/null | awk -F'= ' '/CPU_Speed_Limit/{print $2; exit}'); [ -z "$l" ] || [ "$l" -ge 100 ]; }
running()      { pgrep -x xmrig >/dev/null 2>&1; }
start_miner()  { running && return 0; echo "$(date '+%F %T') guard: START" >>"$LOG"; nohup "$XMRIG" --config="$CONFIG" >>"$LOG" 2>&1 & }
stop_miner()   { running || return 0; echo "$(date '+%F %T') guard: PAUSE" >>"$LOG"; pkill -x xmrig 2>/dev/null || true; }

trap 'stop_miner; echo "guard exiting" >>"$LOG"; exit 0' INT TERM
echo "miner-guard up: mine when idle>${IDLE_THRESHOLD}s, AC=${REQUIRE_AC}, thermal-ok. Re-check every ${INTERVAL}s."

while true; do
  reason=""
  if   [ -f "$STOP_FLAG" ];                         then reason="manual STOP flag"
  elif [ "$REQUIRE_AC" = "1" ] && ! is_ac;          then reason="on battery"
  elif ! thermal_ok;                                then reason="thermal throttling"
  else
    idle="$(idle_secs)"; idle="${idle:-0}"
    [ "$idle" -lt "$IDLE_THRESHOLD" ] && reason="active use (idle ${idle}s)"
  fi

  if [ -z "$reason" ]; then start_miner; echo "MINING" >"$STATE"
  else                      stop_miner;  echo "paused: $reason" >"$STATE"; fi
  sleep "$INTERVAL"
done
