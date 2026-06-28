#!/usr/bin/env bash
# Mesh miner bootstrap — run on a NEW Apple-Silicon Mac to join the fleet mining Monero.
# Robust v2: auto RandomX mode (no OOM crash-loop on 8GB), API exposed on the tailnet so the lab
# Mac can monitor it, and a startup self-check that surfaces errors instead of silently dying.
set -uo pipefail
SRC="${SRC:-http://TAILNET_IP:8799}"
RIG="${RIG:-$(scutil --get ComputerName 2>/dev/null | tr ' ' '-' | tr -cd 'A-Za-z0-9-' || echo mesh-mac)}"
XMR="XMR_ADDRESS"
DIR="$HOME/cpu-miner"; mkdir -p "$DIR/logs"
# tailnet IP (so the lab Mac can poll this miner's API). Falls back to 0.0.0.0 (mesh-private anyway).
TS=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | head -1 || /usr/local/bin/tailscale ip -4 2>/dev/null | head -1 || echo 0.0.0.0)
HOSTBIND="${TS:-0.0.0.0}"

echo "[1/5] fetching native arm64 xmrig …"
curl -fsSL "$SRC/xmrig" -o "$DIR/xmrig" && chmod +x "$DIR/xmrig"
xattr -d com.apple.quarantine "$DIR/xmrig" 2>/dev/null || true

echo "[2/5] writing config (auto mode · API on $HOSTBIND:18000 · rig=$RIG) …"
cat > "$DIR/xmrig.json" <<JSON
{
  "autosave": false, "background": false, "colors": false, "donate-level": 0,
  "cpu": { "enabled": true, "huge-pages": true, "hw-aes": true, "priority": 5, "yield": false, "max-threads-hint": 100 },
  "randomx": { "init": -1, "mode": "auto", "1gb-pages": false },
  "http": { "enabled": true, "host": "$HOSTBIND", "port": 18000, "access-token": "mesh", "restricted": false },
  "pools": [ { "algo": "rx/0", "coin": "monero", "url": "gulf.moneroocean.stream:10128",
               "user": "$XMR", "pass": "$RIG", "rig-id": "$RIG", "keepalive": true, "tls": false } ],
  "log-file": "$DIR/logs/xmrig.log"
}
JSON

echo "[3/5] writing watchdog …"
cat > "$DIR/keepalive.sh" <<KA
#!/usr/bin/env bash
DIR="$DIR"
while true; do
  [ -f "\$DIR/STOP" ] && { pkill -x xmrig 2>/dev/null; sleep 15; continue; }
  if ! pgrep -x xmrig >/dev/null 2>&1; then
    pkill -f "caffeinate -ism" 2>/dev/null || true
    nohup caffeinate -ism "\$DIR/xmrig" --config="\$DIR/xmrig.json" >>"\$DIR/logs/xmrig.log" 2>&1 &
  fi
  sleep 20
done
KA
chmod +x "$DIR/keepalive.sh"

echo "[4/5] starting miner …"
pkill -x xmrig 2>/dev/null || true; pkill -f "caffeinate -ism" 2>/dev/null || true; rm -f "$DIR/STOP"
: > "$DIR/logs/xmrig.log"
nohup caffeinate -ism "$DIR/xmrig" --config="$DIR/xmrig.json" >>"$DIR/logs/xmrig.log" 2>&1 &
nohup bash "$DIR/keepalive.sh" >/dev/null 2>&1 &

echo "[5/5] self-check (waiting 20s for dataset init + first connect) …"
sleep 20
if pgrep -x xmrig >/dev/null 2>&1; then
  echo "  ✅ xmrig RUNNING. recent log:"; grep -iE "randomx|use profile|new job|accepted|pool|error|fault|memory" "$DIR/logs/xmrig.log" | tail -6 | sed 's/^/     /'
  HR=$(curl -s -H 'Authorization: Bearer mesh' http://127.0.0.1:18000/2/summary 2>/dev/null | grep -o '"total":\[[^]]*\]' | head -1)
  echo "  hashrate: ${HR:-warming up}"
else
  echo "  ⚠️ xmrig EXITED — likely cause in log:"; tail -8 "$DIR/logs/xmrig.log" | sed 's/^/     /'
fi
echo
echo "Rig '$RIG' → fleet. Lab Mac can now monitor it at http://$HOSTBIND:18000 (token mesh)."
echo "stop: touch $DIR/STOP   ·   resume: rm $DIR/STOP   ·   log: tail -f $DIR/logs/xmrig.log"
