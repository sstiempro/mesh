#!/usr/bin/env bash
# Curated, reputable bandwidth-DePIN + airdrop apps to run on the Macs (idle bandwidth, not CPU).
# This only PRINTS the official pages — you sign up with your own email/wallet (I never touch credentials).
# Run with `open` arg to launch the signup pages:  bin/setup-depin.sh open
set -uo pipefail
echo "== Bandwidth DePIN — run several at once on EACH Mac + your phone (more unique IPs = more \$) =="
echo
echo "CASH NOW (PayPal/crypto payout, reputable):"
echo "  Honeygain   https://www.honeygain.com         ~\$0.10-0.30/day/device"
echo "  EarnApp     https://earnapp.com   (BrightData) ~\$0.10-0.30/day/device"
echo "  Pawns.app   https://pawns.app      (IPRoyal)   ~\$0.05-0.20/day/device"
echo
echo "AIRDROP FARMING (points -> token, higher risk/upside — the aggressive play):"
echo "  Grass       https://www.getgrass.io            GRASS token, 2.5M+ nodes"
echo "  Nodepay     https://nodepay.ai                 NODE token, 2M+ users"
echo "  Gradient    https://gradient.network           newer, early-farm"
echo
echo "RULES OF THUMB:"
echo "  - They coexist; running 3-5 together is fine (they share idle bandwidth)."
echo "  - Payout scales with UNIQUE IPs: 2 Macs + phone on different connections > 3 apps on one IP."
echo "  - They auto-pause when you're using the machine — zero impact on your work or mining."
echo "  - NEVER pay to join, never give seed phrases. Bandwidth apps just need an email; airdrop apps a wallet ADDRESS."
echo
if [ "${1:-}" = "open" ]; then
  for u in honeygain.com earnapp.com pawns.app getgrass.io nodepay.ai gradient.network; do open "https://$u" 2>/dev/null; done
  echo "opened signup pages in your browser."
else
  echo "Tip: run 'bin/setup-depin.sh open' to launch all signup pages."
fi
