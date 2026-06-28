#!/usr/bin/env bash
# Mine FLAT-OUT now on this machine (all threads, ignores idle-gating). Max hashrate.
set -euo pipefail
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkill -f "miner-guard" 2>/dev/null || true   # stop the idle gate if it's running
rm -f "$LAB/STOP"; echo xmrig > "$LAB/logs/active-engine"
pkill -x cpuminer 2>/dev/null || true        # if switching back from a cpuminer coin
pkill -x xmrig 2>/dev/null || true
pkill -f "caffeinate -ism" 2>/dev/null || true; sleep 1
# caffeinate -ism = no idle sleep, no system sleep, no disk sleep → M1 holds full clocks, no nap throttle.
nohup caffeinate -ism "$LAB/engine/xmrig/build/xmrig" --config="$LAB/config/xmrig.json" >>"$LAB/logs/xmrig.log" 2>&1 &
echo "MINING flat-out (pid $!) — caffeinated, fast-mode, 0% donate"
