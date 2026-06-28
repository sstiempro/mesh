#!/usr/bin/env bash
# Mine a yespower/yescrypt/ghostrider coin via cpuminer-opt.  args: ALGO POOL USER
set -euo pipefail
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$LAB/engine/cpuminer/cpuminer"
[ -x "$BIN" ] || { echo "cpuminer not built yet — run bin/build-cpuminer.sh"; exit 3; }
ALGO="${1:?algo}"; POOL="${2:?pool}"; USER="${3:?user}"
rm -f "$LAB/STOP"; echo cpuminer > "$LAB/logs/active-engine"
pkill -x xmrig 2>/dev/null || true
pkill -x cpuminer 2>/dev/null || true
pkill -f "caffeinate -ism" 2>/dev/null || true
sleep 1
nohup caffeinate -ism "$BIN" -a "$ALGO" -o "stratum+tcp://$POOL" -u "$USER" -p x >>"$LAB/logs/cpuminer.log" 2>&1 &
echo "CPUMINER $ALGO -> $POOL (pid $!)"
