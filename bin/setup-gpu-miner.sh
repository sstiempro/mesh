#!/usr/bin/env bash
# EXPERIMENTAL — Apple-Silicon GPU mining via Metal. My earlier "no GPU miner exists" was WRONG: there
# are real ones. This stages SiliconMiner (rovo79) — a Metal compute miner for M-series GPUs — so the
# integrated GPU can mine alongside the CPU (e.g. KawPow/Ravencoin via Metal, or RandomX-on-Metal WIP).
#
# HONEST THERMAL CAVEAT: on a FANLESS M1 Air, running the GPU + CPU together heats the SoC → the CPU
# RandomX clocks DOWN, so net hashrate can DROP. GPU co-mine is a WIN on a COOLED Mac (Mini / 14"/16" Pro
# with fans), a likely LOSS on the Air. Run it on the cooled boxes, not the Air. Other options found:
#   • ThinMinerPro  https://github.com/rezahussain/thinminerpro   (KawPow, Swift+Metal, prebuilt binary)
#   • MacMetalMiner https://github.com/MacMetalMiner/MacMetal-Miner (SHA-256 Metal, 900+ MH/s)
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$LAB/engine/gpu"; mkdir -p "$ENG"
echo "[clone] SiliconMiner (Apple M-series GPU / Metal)"
[ -d "$ENG/SiliconMiner/.git" ] || git clone --depth 1 https://github.com/rovo79/SiliconMiner "$ENG/SiliconMiner"
echo "[info] also available: ThinMinerPro (KawPow prebuilt) — fetch from its Releases page if you want a"
echo "       ready binary instead of building."
cat > "$ENG/README.txt" <<TXT
Apple Silicon GPU mining — staged, NOT auto-started (thermal caveat above).
 1. SiliconMiner: see engine/gpu/SiliconMiner — build per its README (Swift + Metal), point at a pool.
 2. ThinMinerPro (KawPow/Ravencoin, easiest): download the Apple-Silicon build from
    https://github.com/rezahussain/thinminerpro/releases , edit config.json (unmineable-style user so you
    can be paid in BTC/XMR for RVN hashes), run ./thinminerpro in Terminal.
 3. Run GPU mining ONLY on a cooled Mac (Mini / Pro). On the fanless Air it throttles the CPU miner.
Expected: M1 GPU KawPow is modest (single-digit MH/s) — small earner, but it's free idle silicon on a
cooled box. Pair GPU(RVN) + CPU(XMR) for true dual-mining on the Mini/Pro.
TXT
echo "Staged GPU miner in $ENG. Read engine/gpu/README.txt. Do NOT run on the fanless Air."
