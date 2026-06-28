#!/usr/bin/env bash
# Make the fleet survive logout/reboot: launchd agents for (1) the dashboard server and
# (2) the miner watchdog. Idempotent — re-run to refresh. macOS user LaunchAgents (no sudo).
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"; LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA" "$LAB/logs"
PATHV="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

write_plist(){ # label  program-args...
  local label="$1"; shift
  local args=""; for a in "$@"; do args="$args
    <string>$a</string>"; done
  cat > "$LA/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>$args
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATHV</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LAB/logs/$label.out.log</string>
  <key>StandardErrorPath</key><string>$LAB/logs/$label.err.log</string>
</dict></plist>
PLIST
  launchctl unload "$LA/$label.plist" 2>/dev/null || true
  launchctl load  "$LA/$label.plist"
  echo "loaded $label"
}

write_plist com.xyzmining.dashboard "$NODE" "$LAB/dashboard/server.mjs"
write_plist com.xyzmining.keepalive /bin/bash "$LAB/bin/keepalive.sh"

echo "--- launchd status ---"
launchctl list | grep xyzmining || true
echo "Dashboard auto-starts on login at http://127.0.0.1:8787 ; miner watchdog keeps xmrig alive."
