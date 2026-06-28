#!/usr/bin/env bash
# Install + persist the auto-protect governor on THIS node (run it on the dashboard host — the Air).
# Single instance: it governs the whole mesh via the dashboard API. Idempotent.
set -euo pipefail

LAB="$(cd "$(dirname "$0")/.." && pwd)"
GOV="$LAB/dashboard/governor.mjs"
LABEL="com.xyzmining.governor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

NODE="$(command -v node || true)"
[ -z "$NODE" ] && for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do [ -x "$c" ] && NODE="$c" && break; done
[ -z "$NODE" ] && { echo "✗ node not found"; exit 1; }
[ -f "$GOV" ] || { echo "✗ governor not found at $GOV"; exit 1; }

mkdir -p "$LAB/logs" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$GOV</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$LAB/logs/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$LAB/logs/$LABEL.err.log</string>
</dict></plist>
EOF

# kill any manual instance, then (re)load via launchd
pkill -f "dashboard/governor.mjs" 2>/dev/null || true; sleep 1
launchctl bootout  "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
sleep 3
if [ -f "$LAB/logs/governor-state.json" ]; then
  echo "✓ governor live + persisted (launchd $LABEL) — auto-protect running"
else
  echo "⚠ installed but no state yet — check $LAB/logs/$LABEL.err.log"
fi