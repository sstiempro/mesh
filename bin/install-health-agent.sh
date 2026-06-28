#!/usr/bin/env bash
# Install + persist the mesh health-agent on THIS Mac node (Air, Ausra, any future Mac).
# Idempotent. Run it once per node:  bash bin/install-health-agent.sh
set -euo pipefail

LAB="$(cd "$(dirname "$0")/.." && pwd)"
AGENT="$LAB/dashboard/health-agent.mjs"
LABEL="com.xyzmining.health-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${HEALTH_PORT:-18890}"
TOKEN="${HEALTH_TOKEN:-mesh}"

# locate node
NODE="$(command -v node || true)"
[ -z "$NODE" ] && for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do [ -x "$c" ] && NODE="$c" && break; done
[ -z "$NODE" ] && { echo "✗ node not found — install node first"; exit 1; }
[ -f "$AGENT" ] || { echo "✗ agent not found at $AGENT — pull/copy the lab first"; exit 1; }

mkdir -p "$LAB/logs" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$AGENT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>HEALTH_PORT</key><string>$PORT</string>
    <key>HEALTH_TOKEN</key><string>$TOKEN</string>
  </dict>
  <key>StandardOutPath</key><string>$LAB/logs/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$LAB/logs/$LABEL.err.log</string>
</dict></plist>
EOF

# (re)load
launchctl bootout  "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
sleep 1
if curl -s -m 4 "http://127.0.0.1:$PORT/health?token=$TOKEN" >/dev/null 2>&1; then
  echo "✓ health-agent live on :$PORT ($(hostname)) — persisted via launchd ($LABEL)"
else
  echo "⚠ installed but not yet answering on :$PORT — check $LAB/logs/$LABEL.err.log"
fi