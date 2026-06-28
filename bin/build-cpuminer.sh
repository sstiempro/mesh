#!/usr/bin/env bash
# Build cpuminer-opt (yespower/yescrypt/ghostrider/argon2 — the CPU-only coins) natively on Apple Silicon.
# Clang only (gcc doesn't work on arm64). Output binary → engine/cpuminer/cpuminer.
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$LAB/engine/cpuminer"; mkdir -p "$ENG"
echo "[deps] brew autoconf automake libtool gmp openssl curl jansson"
brew list autoconf >/dev/null 2>&1 || brew install autoconf automake libtool gmp openssl curl jansson 2>&1 | tail -3
SRC="$ENG/src"
# JayDDee/cpuminer-opt does NOT build on arm64 (algo-gate references x86-only algos). Use the
# Apple-Silicon yespower/yescrypt fork — builds clean with clang, covers the yespower CPU coins.
rm -rf "$SRC"
echo "[clone] MacOS cpuminer yespower fork"
git clone --depth 1 https://github.com/xyephy/MacOS-cpuminer-mc-yespower "$SRC" 2>/dev/null || \
git clone --depth 1 https://github.com/whiveio/whive-cpuminer-mc-yespower "$SRC"
cd "$SRC"
# PATCH (Apple Silicon): miner.h unconditionally does `#define HAVE_SHA256_4WAY 1`, but the 4-way
# SHA256 is implemented only in x86/arm32 assembly. On aarch64 there's no impl → undefined symbols
# at link. Guard the define to arches that actually ship the implementation. yespower/yescrypt are
# unaffected (they use the NEON path in yescrypt-neon.c).
perl -0pi -e 's/#define HAVE_SHA256_4WAY 1/#if defined(__x86_64__) || defined(__i386__) || (defined(__arm__) \&\& defined(__APCS_32__))\n#define HAVE_SHA256_4WAY 1\n#endif/' miner.h
grep -q "defined(__x86_64__) || defined(__i386__)" miner.h && echo "[patch] HAVE_SHA256_4WAY guarded for aarch64" || echo "[patch] WARN: guard not applied"
echo "[autogen]"; ./autogen.sh >/tmp/cpuminer-build.log 2>&1
export PKG_CONFIG_PATH="$(brew --prefix openssl)/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
echo "[configure]"; ./configure CFLAGS="-O3 -mcpu=apple-m1" >>/tmp/cpuminer-build.log 2>&1 || ./configure CFLAGS="-O3" >>/tmp/cpuminer-build.log 2>&1
echo "[make]"; make -j"$(sysctl -n hw.ncpu)" >>/tmp/cpuminer-build.log 2>&1
BIN="$SRC/cpuminer"; [ -x "$BIN" ] || BIN="$SRC/minerd"
if [ -x "$BIN" ]; then
  cp "$BIN" "$ENG/cpuminer"
  echo "BUILD_OK → $ENG/cpuminer"
  "$ENG/cpuminer" --version 2>&1 | head -2
  echo "ALGOS:"; "$ENG/cpuminer" --help 2>&1 | grep -iE "yespower|yescrypt|ghostrider|argon" | head
else
  echo "BUILD_FAILED — tail of log:"; tail -25 /tmp/cpuminer-build.log
  exit 1
fi
