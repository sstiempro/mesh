#!/usr/bin/env bash
# Build xmrig from source (Homebrew dropped mining software from core) + scaffold config.
# Run this on AC power — the compile is CPU-heavy for a couple of minutes.
set -euo pipefail
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LAB"

if ! pmset -g batt | grep -q "'AC Power'"; then
  echo "⚠️  You're on battery. The xmrig compile will pin all cores + heat a fanless Air."
  read -r -p "    Plug in and continue anyway? [y/N] " ok; [ "${ok:-N}" = "y" ] || exit 1
fi

echo "==> Installing build deps via Homebrew (bottle downloads, fast)..."
command -v brew >/dev/null || { echo "Homebrew required"; exit 1; }
for p in cmake hwloc libuv openssl@3; do
  brew list "$p" >/dev/null 2>&1 || brew install "$p"
done

echo "==> Fetching + building xmrig (RandomX — Monero/Verus/Zephyr)..."
mkdir -p engine && cd engine
[ -d xmrig ] || git clone --depth 1 https://github.com/xmrig/xmrig.git
cd xmrig && mkdir -p build && cd build
cmake .. -DWITH_HWLOC=ON >/dev/null
make -j"$(sysctl -n hw.ncpu)"
echo "==> Built: engine/xmrig/build/xmrig"

cd "$LAB"
if [ ! -f config/xmrig.json ]; then
  TOKEN="$(openssl rand -hex 16)"
  sed "s/REPLACE_WITH_RANDOM_TOKEN/$TOKEN/" config/xmrig.json.template > config/xmrig.json
  echo "==> Wrote config/xmrig.json with a fresh API token."
  echo
  echo "    NEXT: edit config/xmrig.json and set pools[0].user to your PUBLIC wallet address."
  echo "    (Pick coin/pool in config/pools.md. NEVER paste a seed phrase / private key.)"
else
  echo "==> config/xmrig.json already exists — leaving it (and your address) untouched."
fi
echo
echo "Done. Then: ./bin/start.sh   (and: node dashboard/server.mjs)"
