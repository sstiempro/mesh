#!/usr/bin/env bash
# Keep the public repo (github.com/sstiempro/mesh) updated with the latest code — always SCRUBBED.
# Exports tracked files, prunes the infra/ops bits, scrubs every IP/wallet/key, HARD-scans (aborts on any
# leak), then commits the update onto the public repo's existing history (grows the Builder Score signal).
set -uo pipefail
REPO="sstiempro/mesh"
DEV="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; PUB="$(mktemp -d)"
trap 'rm -rf "$TMP" "$PUB"' EXIT

cd "$DEV"
git archive HEAD | tar -x -C "$TMP"
cd "$TMP"
# prune to the clean product subset (no infra/ops/secrets)
rm -rf CLAUDE.md docs config/wallets-watch.json config/agent-wallet.json config/*.caddy config/Caddyfile.template config/playbook.json desktop 2>/dev/null
rm -f bin/setup-dns.sh bin/stop-xmr-vps.sh bin/setup-boinc-vps.sh bin/setup-merge-mine.sh bin/join-mesh.sh config/xmrig-proxy.json.template 2>/dev/null
# scrub IPs / wallets / SSH / hosts → placeholders
find . -type f \( -name '*.mjs' -o -name '*.html' -o -name '*.json' -o -name '*.sh' -o -name '*.md' -o -name '*.ts' \) -exec sed -i '' -E \
  -e 's/217\.216\.110\.159/VPS_IP/g' -e 's/51\.222\.143\.211/VPS_IP/g' \
  -e 's/100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/TAILNET_IP/g' \
  -e 's/0xYOUR_WALLET/0xYOUR_WALLET/gI' \
  -e 's/YOUR_SSH_KEY/YOUR_SSH_KEY/g' -e 's/4[89][0-9A-Za-z]{93,104}/XMR_ADDRESS/g' {} + 2>/dev/null
# HARD scan — abort on any of the operator's secrets
HITS=$(grep -rEn '0x91938E88|217\.216\.110\.159|51\.222\.143\.211|100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\.[0-9]+\.[0-9]+|4[89][0-9A-HJ-NP-Za-km-z]{93,}|hermes_vps|62e86b2519a3bd9e' . 2>/dev/null | grep -v package-lock)
if [ -n "$HITS" ]; then echo "✗ ABORT — secrets present:"; echo "$HITS" | head; exit 1; fi
echo "✓ scrub clean"
# overlay onto the public repo's history + push
gh repo clone "$REPO" "$PUB" -- -q 2>/dev/null
rsync -a --delete --exclude='.git' --exclude='node_modules' "$TMP"/ "$PUB"/
cd "$PUB"
git add -A
if git diff --cached --quiet; then echo "no changes to push"; exit 0; fi
git -c user.name="sstiempro" -c user.email="sstiem.pro@gmail.com" commit -q -m "${1:-update: latest engines + functional tools}"
git push -q origin HEAD && echo "✓ pushed to https://github.com/$REPO"
