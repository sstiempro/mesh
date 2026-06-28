#!/usr/bin/env bash
# Kill switch: stop miner + guard, set STOP flag so nothing restarts until ./bin/start.sh.
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
touch "$LAB/STOP"
pkill -f "miner-guard.sh" 2>/dev/null || true
pkill -x xmrig 2>/dev/null || true
echo "stopped: miner + guard halted, STOP flag set."
