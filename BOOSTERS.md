# Hashrate boosters — squeezing the existing hardware

No new hardware. Every lever below is software/config/OS on the M1 Air + the mesh. Ordered by
**alpha-per-effort**. Honest multipliers from xmrig docs + benchmarks (sources at bottom).

> Reality anchor: an 8GB M1 Air tops out ~1.5–2.0 kH/s RandomX. These boosters compound that, they don't
> change the order of magnitude. The biggest *revenue* lever isn't raw H/s — it's **merge-mining** (#2):
> the same hashes get paid twice.

---

## TIER 1 — do these now (free, on this Mac)

### 1. Turbo (fast dataset) instead of light mode — **~4–5×**
RandomX has two memory modes. We run **light** (256 MB) for stability; **fast** allocates the full
**2 GB dataset** and runs several times faster. On an 8 GB Mac it's tight but workable if you cap threads
and aren't running a heavy IDE at the same time.
- **Dashboard → Controls → ⚡ Turbo** sets `mode:fast` + 4 threads in one click.
- The keepalive watchdog restarts xmrig within 20 s if Turbo ever OOM-kills — so it's safe to try.
- Drop back to **Light** before heavy coding sessions.
- *Why it works:* light mode recomputes dataset entries on the fly every hash; fast mode reads them from
  the pre-built 2 GB table. Pure speed-for-RAM trade.

### 2. Merge-mine Monero + Tari — **+100% revenue, 0 extra H/s** ← the real alpha
Tari (XTM) merge-mines with Monero: difficulty is `min(xmr_diff, tari_diff)`, so **every RandomX hash you
already compute gets a shot at an XTM block too.** Same electricity, same hashrate, two coins.
- Architecture: `xmrig → minotari_merge_mining_proxy → monerod + tari base node`.
- Scaffold: `bin/setup-merge-mine.sh` (stages the proxy + config). Heavier than pool mining (wants a Tari
  base node), so the lighter path is a **merge-mine pool** that runs the nodes for you — listed in the script.
- This is the single highest-ROI booster in the whole lab.

### 3. Thread count = P-core count (4), not 8 — **higher H/s + cooler**
The M1 has 4 performance (Firestorm) + 4 efficiency (Icestorm) cores. macOS **does not allow hard core
pinning** (thread affinity is unsupported on Apple Silicon — QoS hints only). But empirically, running
**4 threads** lets the scheduler keep them on the fast P-cores; adding E-core threads adds heat and stale
shares for little gain. Our config already uses `max-threads-hint: 50` (= 4/8). Keep it at 4. Turbo does this.

### 4. Stay on AC + keep it cool — **prevents throttle losses**
RandomX is thermally heavy. On battery, macOS clocks the M1 down hard. Plugged in + good airflow (or a
laptop stand/fan) keeps the P-cores at full clock. A throttled M1 can lose 30–50% silently. `caffeinate`
the session so it doesn't nap.

---

## TIER 2 — the exotic ceiling (bigger gains, real setup cost)

### 5. Asahi Linux on the M1 — **~2× over macOS**
The big one. Bare-metal **Asahi Linux** (Fedora Asahi Remix) on Apple Silicon unlocks what macOS blocks:
- **Huge pages** (up to **+50%** on RandomX) — macOS has no equivalent.
- **1 GB pages** (Linux-only, +1–3% more).
- Real **thread affinity** to pin P-cores.
- Disable hardware prefetchers for RandomX.
Combined, Asahi miners report roughly double the macOS RandomX hashrate on the same chip. Cost: a
dual-boot install. This is the highest *raw H/s* move available without new hardware. Opt-in — it's an OS
install, not a script I'll run for you.

### 6. xmrig built with full optimizations (have) — **baseline correctness**
Our xmrig is compiled from source (not a generic brew bottle), so it ships the hand-written ARM64v8
assembly path + hardware AES that the M1 needs. Verify with `xmrig --print-time=1` showing `HW AES = true`
and `ASM = true`. If a future rebuild loses these, hashrate halves.

### 7. Mining proxy for the fleet — **fewer stale shares, cleaner stats**
`xmrig-proxy` (template already in `config/xmrig-proxy.json.template`) aggregates every miner in the mesh
into one pool connection. Marginal H/s, but it cuts stale-share loss and gives one unified worker view.
Worth it once more than one box is actually mining.

---

## TIER 3 — x86 tricks that DON'T apply here (so you know why)

These are real RandomX boosters, but not for this fleet:
- **MSR mod (+15%)** and **disable hardware prefetcher** — x86-only (Intel/AMD model-specific registers).
  The M1 has no MSRs; can't apply.
- **1 GB pages on the VPS** — would help *if* the VPS could PoW-mine, but **Contabo/OVH ToS bans PoW
  mining on the VPS.** So the x86 boxes don't mine coins at all — they earn via **BOINC/Gridcoin**
  (useful-work, ToS-legal). Their "booster" is just more BOINC project throughput, which the 50%-CPU
  throttle deliberately caps so it never fights the trading platform.

---

## What "turbocharged" realistically looks like here

| Lever | Multiplier | Effort |
|---|---|---|
| Turbo (fast mode) | ~4–5× | 1 click |
| Merge-mine Tari | +100% revenue | medium (proxy) |
| 4 P-core threads | +10–25% | already set |
| AC + cooling | recover up to ~30–50% lost to throttle | trivial |
| Asahi Linux | ~2× on top of macOS | OS install |
| **Stacked realistic ceiling** | **macOS Turbo+merge, or Asahi+merge for the max** | — |

Even fully stacked, an M1 Air is a **cents-to-low-dollars/day** machine — the value is the *system*: a
fleet that's tuned, multi-coin, merge-mining, and earning legitimately on every box. The boosters make it
the best it can be on the silicon you own.

---

### Sources
- [XMRig RandomX Optimization Guide](https://xmrig.com/docs/miner/randomx-optimization-guide) — huge pages +50%, 1GB +1–3%, MSR +15%, modes
- [XMRig CPU config (modes, threads)](https://xmrig.com/docs/miner/config/cpu)
- [XMRig Apple M1 benchmarks](https://xmrig.com/benchmark?cpu=Apple+M1)
- [Tari — Monero Merged Mining](https://tlu.tarilabs.com/mining/merged-mining-monero) · [RFC-0132](https://rfc.tari.com/RFC-0132_Merge_Mining_Monero)
- [Asahi Linux](https://asahilinux.org/) — bare-metal Linux on Apple Silicon (huge pages, affinity)
- Apple Silicon P/E cores + affinity unsupported: [Eclectic Light Co.](https://eclecticlight.co/2024/02/19/apple-silicon-1-cores-clusters-and-performance/), [Apple Developer Forums](https://developer.apple.com/forums/thread/703361)
