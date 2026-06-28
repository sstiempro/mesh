#!/usr/bin/env bash
# Build xmrig on Ubuntu/Debian. For genuinely SPARE Linux boxes only.
# ⚠️  Do NOT run on a production box that's already CPU-bound (e.g. the Omnione trading VPS) or one whose
#     provider ToS restricts mining. The linux guard load-gates, but a busy/ToS box still shouldn't hash.
set -euo pipefail
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$LAB"

echo "==> Installing build deps (apt)..."
sudo apt-get update -y
sudo apt-get install -y git build-essential cmake automake libtool autoconf libuv1-dev libssl-dev libhwloc-dev

echo "==> Fetching + building xmrig..."
mkdir -p engine && cd engine
[ -d xmrig ] || git clone --depth 1 https://github.com/xmrig/xmrig.git
cd xmrig && mkdir -p build && cd build
cmake .. -DWITH_HWLOC=ON >/dev/null
make -j"$(nproc)"
echo "==> Built: engine/xmrig/build/xmrig"

cd "$LAB"
if [ ! -f config/xmrig.json ]; then
  TOKEN="$(openssl rand -hex 16)"
  sed "s/REPLACE_WITH_RANDOM_TOKEN/$TOKEN/" config/xmrig.json.template > config/xmrig.json
  echo "==> Wrote config/xmrig.json (API token generated)."
fi
echo
echo "Next on this node:  ./bin/join-mesh.sh <coordinator-tailnet-ip:3333>   (then it load-gates automatically)"
