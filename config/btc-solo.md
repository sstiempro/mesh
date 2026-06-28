# The BTC-on-CPU lottery sliver (optional)

You asked to keep a real Bitcoin shot on the CPU. It's not *impossible* — it's a lottery with
~1-in-hundreds-of-billions daily odds on an M1. It costs only electricity, and you ARE genuinely in
the draw. Here's the honest setup.

## Why it's a separate tool
xmrig does **RandomX**, not Bitcoin's **SHA-256d**. BTC needs a SHA-256d CPU miner: **cpuminer**
(`cpuminer-opt` by JayDDee, or `cpuminer-multi`). Note: these are tuned for x86 SIMD and **building on
Apple Silicon (arm64) is finicky** — expect to fight the build, and the hashrate will be low (~MH/s).
That's fine: at lottery odds, hashrate barely matters.

## Solo pool (so a win pays YOU the whole block, not a pool split)
- **solo.ckpool.org:3333** — no signup. Username = your **BTC public address**, any password.
- A win pays the full block (~3.13 BTC) minus ckpool's 2% fee, straight to that address.

## Run (once cpuminer is built)
```bash
./cpuminer -a sha256d -o stratum+tcp://solo.ckpool.org:3333 \
  -u bc1YOUR_BTC_PUBLIC_ADDRESS -p x -t 3
```
`-t 3` caps threads (leave headroom + heat down). Wrap it in the same guard pattern as xmrig if you
want it idle/AC/thermal-gated too.

## Honest expectation
You will almost certainly never hit a block this way. The real BTC play is a **Bitaxe** (~120,000× the
M1's SHA-256 rate for ~18 W), which can also mine other SHA-256 coins (BCH, DGB, eCash) or merge-mine
(Namecoin/RSK/Syscoin) for the same hashes. See chat notes for Bali sourcing + DIY build.
