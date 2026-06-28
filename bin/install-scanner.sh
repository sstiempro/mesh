#!/usr/bin/env bash
# Install + persist the Opportunity scanner (keyless yield + arb snapshots → persistence dataset). Idempotent.
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
REC="$LAB/dashboard/opportunity-scanner.mjs"
LABEL="com.xyzmining.scanner"
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
pkill -f "dashboard/opportunity-scanner.mjs" 2>/dev/null || true; sleep 1
launchctl bootout  "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
sleep 2
echo "✓ opportunity scanner persisted (launchd $LABEL) — yield/arb snapshots → data/opportunities.jsonl"
