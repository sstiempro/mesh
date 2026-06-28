#!/usr/bin/env bash
set -euo pipefail
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -f "$LAB/STOP"
mkdir -p "$LAB/logs"
if pgrep -f "miner-guard.sh" >/dev/null 2>&1; then
  echo "guard already running."
else
  nohup "$LAB/bin/miner-guard.sh" >>"$LAB/logs/guard.log" 2>&1 &
  echo "guard started (pid $!). It will mine only when you're away + on AC."
fi
