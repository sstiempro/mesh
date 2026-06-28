#!/usr/bin/env bash
# Install + persist the master orchestrator (runs every income micro-task/function on a cadence). Idempotent.
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
REC="$LAB/dashboard/orchestrator.mjs"
LABEL="com.xyzmining.orchestrator"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do [ -x "$c" ] && NODE="$c" && break; done
[ -z "$NODE" ] && { echo "✗ node not found"; exit 1; }
mkdir -p "$LAB/logs" "$LAB/data" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REC</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LAB/logs/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$LAB/logs/$LABEL.err.log</string>
</dict></plist>
EOF
pkill -f "dashboard/orchestrator.mjs" 2>/dev/null || true; sleep 1
launchctl bootout  "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
sleep 2
echo "✓ orchestrator persisted (launchd $LABEL) — all micro-tasks on cadence → data/automation-status.json"
