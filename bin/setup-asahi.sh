#!/usr/bin/env bash
# Run this ON the Mac AFTER you've installed Asahi Linux (Fedora Asahi Remix) and rebooted into it.
# It unlocks what macOS blocks for RandomX — huge pages, 1GB pages, MSR mod — for ~2× the macOS hashrate
# on the SAME M1. The only step this CAN'T do for you is the Asahi install itself (it repartitions the
# disk and is interactive): run  curl https://alx.sh | sh  in macOS Terminal first, reboot, then run this.
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
echo "[1/5] reserve huge pages (2.5GB for the RandomX dataset+scratchpads)"
sudo sysctl -w vm.nr_hugepages=1280
echo "vm.nr_hugepages=1280" | sudo tee /etc/sysctl.d/99-xmrig-hugepages.conf >/dev/null

echo "[2/5] enable MSR mod (the +15% x86-style tweak — works on Asahi, not macOS)"
sudo modprobe msr 2>/dev/null || true
echo msr | sudo tee /etc/modules-load.d/msr.conf >/dev/null

echo "[3/5] 1GB pages — add to kernel cmdline (needs ONE reboot to take effect)"
if ! grep -q "hugepagesz=1G" /proc/cmdline 2>/dev/null; then
  echo "  → add 'default_hugepagesz=1G hugepagesz=1G hugepages=3' to the kernel cmdline:"
  echo "     sudo grubby --update-kernel=ALL --args='default_hugepagesz=1G hugepagesz=1G hugepages=3'  &&  sudo reboot"
fi

echo "[4/5] build native xmrig for Linux/aarch64 (hardened-runtime is gone → full-speed JIT)"
sudo dnf install -y git cmake gcc gcc-c++ make automake libtool libuv-devel openssl-devel hwloc-devel >/dev/null 2>&1 || true
ENG="$LAB/engine/xmrig-linux"; mkdir -p "$ENG"
[ -d "$ENG/src" ] || git clone --depth 1 https://github.com/xmrig/xmrig "$ENG/src"
cd "$ENG/src"; mkdir -p build && cd build && cmake .. >/dev/null && make -j"$(nproc)" >/dev/null
echo "  built: $ENG/src/build/xmrig"

echo "[5/5] start mining with the Asahi-tuned config (1gb-pages + msr + hugepages)"
"$ENG/src/build/xmrig" -c "$LAB/config/xmrig-asahi.json" &
echo "DONE — compare the hashrate to macOS; expect roughly 2×. (1GB pages need the reboot from step 3.)"
