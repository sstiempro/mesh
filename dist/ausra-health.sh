#!/usr/bin/env bash
# Self-contained health-agent onboarder for any mesh Mac (run ON that Mac).
# Handles a node-less box (Ausra): fetches portable node + the agent, persists via launchd.
# One-liner:  curl -fsSL http://TAILNET_IP:8799/ausra-health.sh | bash
set -uo pipefail
SRC="${SRC:-http://TAILNET_IP:8799}"
APP="$HOME/.xyzmining"; mkdir -p "$APP/logs" "$HOME/Library/LaunchAgents"
echo "== xyzmining health onboard · $(hostname) =="

# [1/4] node (Ausra has none → fetch portable arm64, no sudo, no Homebrew)
NODE="$(command -v node || true)"
for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node "$APP/node/bin/node"; do
  [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"
done
if [ -z "$NODE" ]; then
  echo "[1/4] node not found — fetching portable node v22.22.3 (arm64)…"
  curl -fsSL "https://nodejs.org/dist/v22.22.3/node-v22.22.3-darwin-arm64.tar.gz" -o "$APP/node.tgz" || { echo "✗ node download failed"; exit 1; }
  mkdir -p "$APP/node"; tar -xzf "$APP/node.tgz" -C "$APP/node" --strip-components=1 && rm -f "$APP/node.tgz"
  NODE="$APP/node/bin/node"
else echo "[1/4] node present: $NODE"; fi
echo "      $("$NODE" -v 2>/dev/null)"

# [2/4] health-agent
echo "[2/4] fetching health-agent…"
curl -fsSL "$SRC/health-agent.mjs" -o "$APP/health-agent.mjs" || { echo "✗ agent download failed (is the Air's dist server up?)"; exit 1; }

# [3/4] launchd (env makes it lab-independent: it reads the LOCAL xmrig API on :18000 token mesh)
echo "[3/4] installing launchd agent…"
LABEL="com.xyzmining.health-agent"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/health-agent.mjs</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>HEALTH_PORT</key><string>18890</string><key>HEALTH_TOKEN</key><string>mesh</string>
    <key>XMRIG_PORT</key><string>18000</string><key>XMRIG_TOKEN</key><string>mesh</string>
  </dict>
  <key>StandardOutPath</key><string>$APP/logs/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$APP/logs/$LABEL.err.log</string>
</dict></plist>
EOF
launchctl bootout  "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

# [4/4] verify
sleep 2
echo "[4/4] verify…"
if curl -s -m5 "http://127.0.0.1:18890/health?token=mesh" >/dev/null 2>&1; then
  echo "✓ health-agent LIVE on :18890 — $(hostname) vitals + control now flow to the dashboard."
else
  echo "⚠ not answering yet — check $APP/logs/$LABEL.err.log"
fi