#!/usr/bin/env bash
# Engine-aware watchdog: keeps whichever miner the fleet selected (xmrig RandomX, or cpuminer yespower)
# alive within ~20s. Reads $LAB/logs/active-engine (xmrig|cpuminer). Respects the STOP flag.
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
while true; do
  if [ -f "$LAB/STOP" ]; then pkill -x xmrig 2>/dev/null; pkill -x cpuminer 2>/dev/null; sleep 15; continue; fi
  ENGINE="$(cat "$LAB/logs/active-engine" 2>/dev/null || echo xmrig)"
  if [ "$ENGINE" = "cpuminer" ]; then
    if ! pgrep -x cpuminer >/dev/null 2>&1; then
      echo "$(date '+%F %T') keepalive: cpuminer dead — leaving restart to /api/coin (needs algo/pool)" >>"$LAB/logs/cpuminer.log"
    fi
  else
    if ! pgrep -x xmrig >/dev/null 2>&1; then
      echo "$(date '+%F %T') keepalive: restarting xmrig" >>"$LAB/logs/xmrig.log"
      pkill -f "caffeinate -ism" 2>/dev/null || true
      nohup caffeinate -ism "$LAB/engine/xmrig/build/xmrig" --config="$LAB/config/xmrig.json" >>"$LAB/logs/xmrig.log" 2>&1 &
    fi
  fi
  sleep 20
done
