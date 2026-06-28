#!/usr/bin/env bash
# Deploy the SAFE, official bandwidth-DePIN clients on THIS Mac (idle bandwidth → cents/day + airdrop call-options).
# Stacks on top of mining (bandwidth, not CPU). Credentials come from a GITIGNORED local file YOU fill — this
# script never contains or transmits them, and I (the agent) never see them.
#
#   1. cp config/depin.local.env.example config/depin.local.env   &&  edit it with YOUR app credentials
#   2. bin/depin-deploy.sh up        # start the clients you filled in
#      bin/depin-deploy.sh status    # what's running
#      bin/depin-deploy.sh down       # stop all
#
# HONEST: ~$0.10-0.30/device/day in bandwidth (pennies). The real bet is the AIRDROP for early node operators.
# RISK: these resell your residential IP to carry 3rd-party (often scraping) traffic. Run only on machines/IPs
# you're OK with that on. VPS are excluded (provider ToS forbids bandwidth-resale, same spirit as the PoW ban).
set -uo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$LAB/config/depin.local.env"
STATE="$LAB/config/free-streams-state.json"
ACTION="${1:-status}"

have(){ command -v "$1" >/dev/null 2>&1; }
DOCKER="$(command -v docker || true)"
mark(){ # mark <id> <true|false> in the state json (so the dashboard shows it live)
  node -e 'const fs=require("fs");const p=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(p))}catch{};s[process.argv[2]]=(process.argv[3]==="true");fs.writeFileSync(p,JSON.stringify(s,null,2));' "$STATE" "$1" "$2" 2>/dev/null || true
}

if [ "$ACTION" = "status" ]; then
  echo "== DePIN clients on $(scutil --get ComputerName 2>/dev/null || hostname) =="
  if [ -n "$DOCKER" ]; then docker ps --filter "label=depin" --format ' {{.Names}}\t{{.Status}}' 2>/dev/null || true; else echo "  (docker not installed)"; fi
  echo "state: $STATE"; [ -f "$STATE" ] && cat "$STATE" 2>/dev/null
  exit 0
fi

if [ "$ACTION" = "down" ]; then
  [ -n "$DOCKER" ] && docker ps -q --filter "label=depin" | xargs -r docker rm -f 2>/dev/null
  for id in honeygain earnapp pawns; do mark "$id" false; done
  echo "✓ all DePIN clients stopped + unmarked."; exit 0
fi

if [ "$ACTION" = "up" ]; then
  [ -z "$DOCKER" ] && { echo "✗ Docker not found. Install Docker Desktop or colima, OR install the native macOS apps (honeygain.com / earnapp.com / pawns.app) and log in — those are arm64-native, no Docker."; exit 1; }
  [ -f "$ENVF" ] || { echo "✗ $ENVF missing. Run: cp config/depin.local.env.example config/depin.local.env  then fill in YOUR credentials."; exit 1; }
  # shellcheck disable=SC1090
  set -a; . "$ENVF"; set +a
  DEV="$(scutil --get ComputerName 2>/dev/null || hostname | tr ' ' '-')"
  echo "== Starting DePIN clients (device: $DEV). Only the ones you filled in will start. =="

  # Honeygain — OFFICIAL image (x86; runs under emulation on Apple Silicon, fine for bandwidth)
  if [ -n "${HONEYGAIN_EMAIL:-}" ] && [ -n "${HONEYGAIN_PASS:-}" ]; then
    docker rm -f honeygain 2>/dev/null
    docker run -d --restart unless-stopped --name honeygain --label depin --platform linux/amd64 \
      honeygain/honeygain -tou-accept -email "$HONEYGAIN_EMAIL" -pass "$HONEYGAIN_PASS" -device "$DEV" \
      && mark honeygain true && echo "  ✓ honeygain up" || echo "  ✗ honeygain failed"
  fi
  # EarnApp — official, arm64-native
  if [ -n "${EARNAPP_UUID:-}" ]; then
    docker rm -f earnapp 2>/dev/null
    docker run -d --restart unless-stopped --name earnapp --label depin \
      -e EARNAPP_UUID="$EARNAPP_UUID" fazalfarhan01/earnapp:lite \
      && mark earnapp true && echo "  ✓ earnapp up" || echo "  ✗ earnapp failed"
  fi
  # Pawns/IPRoyal — official, arm64
  if [ -n "${PAWNS_EMAIL:-}" ] && [ -n "${PAWNS_PASS:-}" ]; then
    docker rm -f pawns 2>/dev/null
    docker run -d --restart unless-stopped --name pawns --label depin \
      iproyal/pawns-cli:latest -email="$PAWNS_EMAIL" -password="$PAWNS_PASS" -device-name="$DEV" -accept-tos \
      && mark pawns true && echo "  ✓ pawns up" || echo "  ✗ pawns failed"
  fi
  echo "Done. 'bin/depin-deploy.sh status' to verify. Earnings show on the dashboard Income page."
  exit 0
fi
echo "usage: depin-deploy.sh [up|down|status]"
