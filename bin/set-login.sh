#!/usr/bin/env bash
# Generate the panel login hash WITHOUT your password ever entering the chat, argv, or shell history.
# `caddy hash-password` prompts interactively (hidden) and prints only a bcrypt hash.
set -euo pipefail
echo "Panel login — pick a username + a STRONG password (password is never shown or stored in plaintext)."
read -r -p "Username: " U
if command -v caddy >/dev/null 2>&1; then
  echo "Enter password at the prompt:"
  H="$(caddy hash-password)"
  echo; echo "Paste this into config/mining-panel.caddy under basic_auth:"; echo "    ${U} ${H}"
else
  echo
  echo "No local caddy. Generate the hash on the VPS instead (caddy is already there):"
  echo "    docker exec -it omnione-caddy caddy hash-password"
  echo "then put:  ${U} <that-hash>  into config/mining-panel.caddy"
fi
