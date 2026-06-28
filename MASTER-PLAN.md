# Mesh Mining — Master Plan (the fused vision)

Goal, in your words: use the **whole mesh** (multiple M1s, other devices, VPS coordination) to mine the
**highest-yield** way, stack the **biggest returns** you realistically can, and keep a **real Bitcoin
jackpot** lane alive — all automated, monitored, and collected to your wallet(s).

This doc fuses everything from the chat into one architecture. It is honest about the ceiling so the
dashboard never lies to you.

---

## 0. The one honest truth that shapes everything
The mining market **arbitrages profitability away**: any coin that gets profitable sees difficulty rise
until $/hash converges. So "highest-yield coin" is NOT a hidden gem you pick — it's:
1. **Auto-switching** to capture the transient arbitrage (MoneroOcean: +10–20%), and
2. **Choosing the payout asset** (XMR to stack Monero, or BTC to feed the Bitcoin dream), and
3. (advanced/risky) **catching brand-new coin launches** before difficulty catches up, then exiting.

**Ceiling reality (CPU):** a strong desktop CPU ≈ $0.20–0.35/day; an **M1 ≈ ~3 kH/s ≈ $0.05–0.08/day**.
The M1 is ultra-efficient (~10–15 W). CPU mining alone is "idle compute → slow auto-stacking + a lottery
ticket," not income.

---

## 0.5 — FREE ELECTRICITY changes the game (the real returns lever)
Operator pays **$0 for power**. That removes the ONLY thing that kills home Bitcoin mining and pivots the
plan from "CPU hobby" to "deploy efficient hashpower."

- **CPU/RandomX fleet:** now **pure profit** — run owned nodes **24/7** (not just idle). Small absolute
  ($0.05–0.08/day per M1) but 100% margin. Keep idle-gating only on machines you actively use (UX/heat, not power).
- **The real lever — used ASICs for BTC.** Free power IS the business case:

  | Miner | Hashrate / power | ~$/day @ FREE power | ~$/day @ $0.07/kWh | Used price |
  |---|---|---|---|---|
  | Antminer S19 (95 TH) | 95 TH/s · 3250 W | **+$3.16** | −$2.30 | **$200–300** |
  | S19 Pro (110 TH) | 110 TH/s · 3250 W | **+$3.76** | −$1.70 | ~$300 |
  | S21 Pro (234 TH) | 234 TH/s · ~3500 W | ~+$7–8 | ~break-even | $$$ |

  A used **S19 (~$250) → ~$3/day → ROI < 3 months, then pure profit**, linear with units. The same S19
  *loses* ~$2/day on paid power → your free power is worth ~$5/day per machine. (Variable with BTC price +
  difficulty; used units can need repair.)
- **Counter-intuitive but correct:** at free power, buy the **cheapest $/TH hardware (old S19s)**, NOT the
  efficient-but-pricey S21 — J/TH efficiency only matters when you pay for joules. (Caveat: old miners run
  hotter + louder → pushes back via the heat/noise limits below.)
- This also makes a real **solo BTC jackpot** viable: each S19 ≈ 95 TH/s is ~80× a Bitaxe, so a few cheap
  S19s on `solo.ckpool` give genuinely better (still long) odds AND steady pool income meanwhile.

### What LIMITS you now (power cost is gone, so these bind instead)
1. **Electrical CAPACITY — the #1 limit in Indonesia.** "Free" ≠ unlimited amps. PLN connections are sized
   in **VA (daya)**: homes are often **1300 / 2200 / 3500 / 5500 VA**. One S19 ≈ 3250 W ≈ ~14 A @ 230 V.
   At 2200 VA you can't run even one S19 without upgrading the connection / you'll trip the MCB. **This caps
   the whole ASIC plan — the daya is the first number we need.**
2. **Heat — tropical penalty.** Each S19 dumps ~3.25 kW of heat; Bali >30 °C ambient weakens air cooling.
   Needs exhaust-to-outdoors / dedicated space; multiple units = a furnace.
3. **Noise.** Air-cooled S19/S21 = **75–83 dB** (vacuum-that-never-stops) → garage/shed/dedicated room, or
   hydro/immersion (38–58 dB, pricey) for indoors.
4. **Capital + import** of a ~15 kg ASIC into Indonesia (customs) vs a pocket Bitaxe.

**Net:** with free power the question is no longer "is it worth the electricity" — it's **"how much
hashpower can my connection + space + capital support."** Size to those three, then deploy.

---

## 1. Three lanes (fused)

### Lane A — RandomX fleet (the earner) · OWNED HARDWARE ONLY
Every owned machine (each M1, any other real computer) runs the **idle-gated guard** from this repo →
`xmrig` → routed through a proxy → highest-yield pool.
- **Payout = XMR:** point at **MoneroOcean** (`gulf.moneroocean.stream`), auto-switch, paid in XMR, 0% fee.
- **Payout = BTC (your dream):** point at **NiceHash** RandomX, sell hashpower, **paid in Bitcoin**.
- **Split:** some nodes → MoneroOcean (XMR), some → NiceHash (BTC). Best of both; decide per node.
- Each node only mines when **on AC + idle + cool** (the guard already enforces this).

### Lane B — BTC jackpot (the dream) · DEDICATED ASIC
SHA-256 is hopeless on CPUs, so this lane is **Bitaxe-class hardware**, not the fleet.
- 1× **Bitaxe Gamma** (1.2 TH/s, ~18 W) → `solo.ckpool.org` = a real (tiny) shot at a full ~3.13 BTC block.
- Scales: a **cluster of Bitaxes / a NerdQaxe++ (~4.8 TH/s)** multiplies the odds (a 6-Bitaxe cluster won a
  block in 2025). Same chip can also mine **BCH/DGB/eCash** or **merge-mine** (Namecoin/RSK/Syscoin) for
  the same hashes — see `config/btc-solo.md`.
- Optional CPU BTC sliver stays available (`cpuminer → solo.ckpool`) — pure lottery, costs only power.

### Lane C — Control plane (the conductor) · VPS IS ALLOWED HERE
The VPS does **coordination, not hashing** — legitimate, low-resource, ToS-safe:
- **xmrig-proxy** or **XMRigCC C&C server**: every node connects to it; it presents **one worker** to the
  pool, aggregates stats, and lets you push config / start / stop / reboot the whole fleet from one panel.
- **Treasury + dashboard:** one pane of glass (extend `dashboard/`) showing per-node hashrate, thermal
  state, fleet total, pending/paid XMR + BTC, and honest $/day vs power.
- Runs on ~1 GB RAM, near-zero CPU → will NOT trip mining-abuse detection or starve the trading platform.
- **Still forbidden on the VPS:** the actual `xmrig`/`cpuminer` hashing process. Muscle stays on owned HW.

---

## 2. Highest-yield routing — decision table

| You want… | Route to | Paid in | Why |
|---|---|---|---|
| Max auto-optimized yield, stack Monero | **MoneroOcean** | XMR | profit-switch +10–20%, 0% fee, min payout 0.003 XMR |
| Stack **Bitcoin** from CPU work (the dream) | **NiceHash** RandomX | **BTC** | sell hashpower at market hashprice, paid in sats |
| Privacy-max / 0-trust | **P2Pool (mini)** | XMR | decentralized, pays per block (needs local monerod) |
| Outsized degen upside (high risk) | new RandomX launch (via CryptUnit watch) | the new coin | low early difficulty; many are scams/illiquid — small allocation only |

**Recommended default:** most nodes → **MoneroOcean (XMR)** for steady auto-optimized stacking; dedicate
**1 node → NiceHash (BTC)** so you're literally turning idle CPU into Bitcoin. Re-balance from the dashboard.

---

## 3. Fleet tooling
- **xmrig-proxy** (xmrig.com/proxy) — lightweight stratum aggregator; 1 pool connection for the whole mesh.
- **XMRigCC** (github.com/Bendr0id/xmrigCC) — xmrig fork with a **Command & Control dashboard**: assign
  config templates, start/stop/restart every node with one click, live monitoring. Best fit for a real fleet.
- **Foreman** — enterprise fleet monitoring if this ever grows past hobby scale.
- Our `dashboard/` already reads a single node; Phase 2 swaps its data source to the proxy/CC for fleet-wide view.

---

## 4. Treasury & collection
- All Lane-A XMR accrues to your **Monero public address**; NiceHash BTC to your **BTC address**; Lane-B
  block (if it ever hits) pays your BTC address directly via ckpool.
- Pools auto-pay at threshold (MoneroOcean 0.003 XMR). Dashboard tracks pending/paid via pool APIs.
- **Keys never touch any node** — public addresses only. Seeds live in your wallet app / hardware wallet.

---

## 5. Phased rollout
1. **Phase 0 — single M1 (now):** `./bin/setup.sh`, drop in address, `./bin/start.sh`. Prove the guard +
   dashboard + payout end-to-end on one machine. (This repo = done, awaiting wallet + AC.)
2. **Phase 1 — pick the route:** MoneroOcean (XMR) and/or NiceHash (BTC). One config line.
3. **Phase 2 — fleet:** stand up xmrig-proxy/XMRigCC on a VPS (coordination only); clone the guard to each
   owned node pointing at the proxy; upgrade `dashboard/` to fleet-wide.
4. **Phase 3 — BTC jackpot:** order a Bitaxe (see Bali sourcing notes) → `solo.ckpool`; scale to a cluster
   if you want better odds; experiment with merge-mining.
5. **Phase 4 — optimize:** add a NiceHash/MoneroOcean profit comparator to the dashboard; auto-route nodes
   to the highest live $/day; optional small "new-launch" degen node.

---

## 6. Hard lines (non-negotiable)
- **No hashing on the production VPSes** (Omnione trading / LeadEngine). Coordination/proxy only.
- **Never paste a seed phrase or private key** anywhere, including configs or to the assistant.
- Owned laptops mine **only** on AC + idle + cool (guard-enforced) to protect the hardware.
- Honest accounting on the dashboard — always show real $/day net of power, never a fantasy number.
