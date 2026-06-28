# Mesh — a keyless, honest engine for turning idle compute into safe income

**Mesh** is a self-hosted, open-source platform that turns a fleet of your own machines into a healthy,
monitored income mesh — and an intelligence engine that decodes free public data into value. It runs on
**free/public data only**, holds **no keys and no custody**, and its core design value is **honesty**:
it tells you when an "edge" is real and when "free money" is a mirage.

> Built in the open as a public good. No API keys, no accounts required to run it, no data leaves your machine.

---

## Why this exists

Millions of people own idle hardware that *could* earn small passive income — bandwidth-DePIN, useful
compute, node-running, airdrops. But the tooling is fragmented, sketchy, and dangerous:

- Most "earn from your PC" guides push closed-source binaries that resell your IP or cook your CPU with
  **no thermal/health protection** — people degrade their hardware for pennies without realizing it.
- The opportunity landscape (which yield is real vs an emissions trap, which spread actually clears fees,
  which airdrop is a scam) is **opaque and full of overfit hype**.
- Nothing ties it together with **honest accounting** — most dashboards show a fantasy "$/day" that never
  materializes.

Mesh fixes all three, keylessly, and refuses to lie to you about the numbers.

## What it does

- **Mesh health + auto-protect governor** — per-node load/RAM/thermal telemetry with a speedometer UI and
  a daemon that throttles or pauses a node *before* it cooks the hardware. An explicit `SAFE→BLOCKED`
  mining-risk verdict answers "is this worth it, or am I burning the machine for pennies?"
- **Keyless opportunity engine** — ranks real DeFi yield (DefiLlama public data) by *organic-fee fraction*
  and persistence, and surfaces cross-exchange / triangular arbitrage **net of fees** — honestly showing
  when the "free money" is gone (it usually is).
- **World-pulse** — keyless market sentiment (Fear & Greed + global stats) as a regime read.
- **Knowledge → money engine** — 100+ EV-ranked, zero-capital income concepts (creation, grants, bounties,
  DePIN, airdrops) with sybil/scam flags, plus a **Monte-Carlo stack tester** that simulates *combinations*
  and surfaces what actually dominates (spoiler: it's tail-driven, and foundations multiply everything).
- **Strategist** — a thinking layer that ranks every avenue by *value-per-energy* and routes effort to the
  highest-value transform, not the lowest (mining hash ranks last, by design).
- **Multi-chain self-custody wallet** — one seed → one address per ecosystem (EVM · Solana · Bitcoin ·
  Cosmos), keys never leave your machine, never printed, never committed.
- **Autonomous content engine** — generates a publishable daily intelligence brief from the live data.
- **Honest earnings ledger + compounding Monte-Carlo** — real day/week/month accrual and a stress-tested
  *distribution*, never a fantasy single number.

## Principles (the public-good part)

- **Keyless + local.** Runs on free public data; binds localhost/tailnet; never handles a private key,
  seed, or credential. Your data and machines stay yours.
- **Hardware-protective.** Actively prevents you from degrading your own machines — a harm the rest of the
  "earn from your PC" space ignores.
- **Honesty-first / anti-mirage.** Most "free money" is small or a mirage; the engine says so. The edge is
  rigor, breadth, and compounding the few real ones — not hype.
- **You own the money.** The system produces value and tracks it; converting value→funds is always your
  signed action. An agent that could move your money for you is how wallets get drained — so it can't.

## Run it

```bash
git clone <this-repo> && cd mesh
node dashboard/server.mjs        # → http://127.0.0.1:8787   (keyless; no setup required to explore)
```

Optional persistent services (macOS launchd): `bin/install-*.sh` for the health-agent, auto-protect
governor, earnings ledger, opportunity scanner, content engine, and the orchestrator that runs every
analysis function on a cadence.

## Architecture

```
node agents (health/telemetry) ─┐
public data (DefiLlama/F&G/...) ─┼─► dashboard/server.mjs ─► engines (yield · arb · pulse · fringe MC ·
mesh miners / DePIN / nodes  ───┘        │                     strategist · knowledge-capital · ledger)
                                         └─► dashboard/index.html  (14 views, all keyless)
orchestrator ─► runs every function on a cadence ─► data/*.jsonl (forward-is-backward history)
```

## Honesty (so the numbers never surprise you)

CPU mining is cents/day and the *worst* use of energy — the strategist deprioritizes it on purpose.
Bandwidth-DePIN is pennies. Most airdrops never pay. Real DeFi yield exists but compounds slowly. The
genuine value here is (1) **not burning your hardware**, (2) a **rigorous, honest map** of what's real, and
(3) the **few high-ratio transforms** (creation, grants, durable yield) compounded over time. No promises.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome; funding via [GitHub Sponsors](.github/FUNDING.yml).

---

*Mesh is a public good: keyless, hardware-protective, honesty-first. If it helps you run your own hardware
safely and see the opportunity landscape clearly, that's the whole point.*
