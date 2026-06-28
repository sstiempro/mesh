#!/usr/bin/env bash
# Benchmark THIS machine on the candidate CPU algos, offline (no pool), and print hashrate.
# Then multiply by live $/hash (see docs/COIN-HARDWARE-MATRIX.md) to rank $/day.
# Works on macOS arm64 (Macs) and Linux x86 (VPS). RandomX = xmrig; GhostRider = cpuminer-opt (x86);
# VerusHash = needs a verus miner (ccminer/nheqminer) — flagged if absent.
set -uo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
XMRIG="$LAB/engine/xmrig/build/xmrig"; [ -x "$XMRIG" ] || XMRIG="/opt/xmr-miner/xmrig"
CPUMINER="$LAB/engine/cpuminer-opt/cpuminer"; [ -x "$CPUMINER" ] || CPUMINER="/opt/cpuminer-opt/cpuminer"
ARCH="$(uname -m)"; OS="$(uname -s)"
echo "== bench-algos on $(hostname) · $OS/$ARCH =="

echo "-- RandomX (Monero) via xmrig --bench --"
if [ -x "$XMRIG" ]; then
  "$XMRIG" --bench=250K 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -iaE "h/s|finished" | tail -3
else echo "   xmrig not found ($XMRIG)"; fi

echo "-- GhostRider (Raptoreum) via cpuminer-opt --"
if [ -x "$CPUMINER" ]; then
  GR=$("$CPUMINER" --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -iE "ghostrider|raptoreum" | awk '{print $1}' | head -1)
  timeout 35 "$CPUMINER" --benchmark -a "${GR:-gr}" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -iaE "Tavg|Total|H/s" | tail -3
else echo "   cpuminer-opt not found — build it (x86: JayDDee/cpuminer-opt; does NOT build on arm64 Mac)"; fi

echo "-- VerusHash (Verus) --"
VERUS="$LAB/engine/verus/verus"; [ -x "$VERUS" ] || VERUS="$(command -v verus_cpuminer 2>/dev/null)"
if [ -n "${VERUS:-}" ] && [ -x "${VERUS:-/nonexistent}" ]; then
  timeout 30 "$VERUS" --benchmark 2>&1 | grep -iaE "MH/s|H/s" | tail -3
else echo "   no verus miner yet — the Verus-on-ARM hypothesis needs ccminer-verus/nheqminer built (TODO)"; fi

echo "== done. Convert H/s × live \$/hash → \$/day (XMR=Kraken, VRSC/RTM=CoinGecko) =="
