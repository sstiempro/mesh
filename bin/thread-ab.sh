#!/usr/bin/env bash
# Find the sustained-max thread count on this M1 via xmrig offline benchmark. Pauses live mining,
# benches a few thread counts, locks the winner into config, ALWAYS restarts mining (trap).
set -uo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$LAB/engine/xmrig/build/xmrig"
restore(){ rm -f "$LAB/STOP"; bash "$LAB/bin/mine-flatout.sh" >/dev/null 2>&1; echo "[restore] mining resumed"; }
trap restore EXIT

echo "[pause] stopping live miner + watchdog for the bench"
touch "$LAB/STOP"; pkill -x xmrig 2>/dev/null; pkill -f "caffeinate -ism" 2>/dev/null; sleep 2

declare -A RES
for N in 8 6 4; do
  echo "[bench] threads=$N (90s) …"
  "$BIN" --bench=1M --threads="$N" --randomx-mode=fast --no-color > "/tmp/bench_$N.log" 2>&1 &
  P=$!; sleep 90; kill "$P" 2>/dev/null; wait "$P" 2>/dev/null
  # grab the highest 'speed' / total reading seen
  hr=$(grep -aoE "[0-9]+\.[0-9]+ [kK]?H/s|speed 10s/60s/15m [0-9]+\.[0-9]+" "/tmp/bench_$N.log" | grep -aoE "[0-9]+\.[0-9]+ [kK]?H/s" | tail -1)
  # normalize kH/s -> H/s
  val=$(grep -aoE "[0-9]+\.[0-9]+ [kK]?H/s" "/tmp/bench_$N.log" | tail -1 | awk '{v=$1; if($2 ~ /kH/) v=v*1000; print int(v)}')
  RES[$N]=${val:-0}
  echo "[bench] threads=$N -> ${RES[$N]:-?} H/s"
done

best=8; bestv=0
for N in 8 6 4; do v=${RES[$N]:-0}; if [ "$v" -gt "$bestv" ]; then bestv=$v; best=$N; fi; done
hint=$(( best*100/8 ))
echo "[result] sustained max = $best threads @ ${bestv} H/s  (max-threads-hint=$hint)"
node -e "const f='$LAB/config/xmrig.json';const c=JSON.parse(require('fs').readFileSync(f));c.cpu['max-threads-hint']=$hint;require('fs').writeFileSync(f,JSON.stringify(c,null,2));console.log('[lock] max-threads-hint set to $hint ($best threads)')"
echo "$best threads / ${bestv} H/s @ $(date)" >> "$LAB/logs/thread-ab.txt"
