---
name: canary
description: The every-pass entry point ("the canary") for the cpu-miner-lab bi-product engine. START HERE on every working pass on the lab, and whenever the operator says "canary", "next pass", "keep building", "knock down the next one", "what's next", "keep going", or "let's do a pass". It chirps the autonomous build loop's health (cron + dashboard + freshness), shows what the loop knocked down on its own + what's queued + which action-cards await the operator, then drives the next avenue to a real, wired, verified, shipped build. The operator is the ideas; this skill is the engine.
---

# 🐤 canary — the every-pass build ritual

The operator's standing deal: **he's the ideas, I'm the engine.** He fires this every pass; it tells me the
loop is alive and hands me the next thing to knock down. Build and ship — don't narrate limits.

## THE LAWS (how I work this lab — non-negotiable)
- **Build, don't document.** A detector that only prints is prettier docs. Every avenue gets a wired
  execution path (auto / deliver / approve) or it isn't done.
- **Results stay true; drop the sermons.** No "it's weeks away," no "that's not possible," no honesty-
  preamble. State real numbers (dollars where they exist), say plainly what runs and what doesn't — then
  move. The goal is outrageous on purpose; the fun is cracking it, not hedging it.
- **Proceed without asking.** Pick the next avenue and build it. Don't ask the operator to point at things.
- **Open-core.** Build the open shell (public, earns Builder Score/grants); gate the sauce (premium.mjs +
  `config/*-pro.local.json`, gitignored). Public push is always scrubbed (`bin/sync-public.sh`).
- **Hard rails (never cross):** keyless-first, $0 capital. **Never** handle keys/seeds/credentials — the
  operator holds all. **Never** auto-execute a trade / transfer / withdrawal / airdrop-claim — those are
  APPROVE-lane cards the operator clicks. **Never touch `~/Developer/omnione`** (separate system).
- **No orphans.** Extend wired code; verify it runs live before calling it done.

## THE PASS (do this in order)

1. **Chirp the canary:** `node tools/canary.mjs`
   Read health, the loop counters, the top pending **specs** (next to build), and the **action cards**.

2. **If TRIPPED → fix infra first**, then re-chirp:
   - builder cron down → `launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.xyzmining.builder.plist`
   - dashboard down → `launchctl kickstart -k "gui/$(id -u)/com.xyzmining.dashboard"`
   - loop STALE (>15min) → check `logs/com.xyzmining.builder.err.log`

3. **Pick the next knock-down** (highest-value first):
   - a top **spec** from the queue (e.g., "package signal X as a paid webhook feed", "cross two monitors
     into a confluence alert", "wire signal into the paper-sim"), **or**
   - if the spec queue is thin: add a **new monitor template** to `dashboard/monitors.mjs` + a param row to
     `tools/idea-gen.mjs` (the loop then mass-produces variants), **or**
   - if action-cards are piling up: tighten the **execution** routing/delivery for that lane.

4. **Build it for real** — keyless, $0, paper-safe. **Wire it**: an `/api/*` endpoint + a dashboard panel +
   a ledger line. **Verify**: hit the endpoint, show real output. No beta, no mock.

5. **Ship**: scoped `git commit` → `bash bin/sync-public.sh "<what>"` (scrub-clean, alpha gated). Append a
   `{"action":"spec-built","sig":"<the spec sig>", ...}` line to `data/build-ledger.jsonl` so the canary
   won't resurface it next pass.

6. **Report in the operator's voice:** what's alive now, the real numbers, the next chirp. One pass = one
   real thing shipped. Then stop (or, if he said "keep going", chirp again and knock down the next).

## The system this drives (already built, extend it)
- Loop: `tools/builder-tick.mjs` (cron `com.xyzmining.builder`, 5min) · ideas: `tools/idea-gen.mjs`
- Monitors: `dashboard/monitors.mjs` (`/api/monitors`, `/api/builder`) — keyless data products
- Execution: `dashboard/execution.mjs` (`/api/execution`, `/api/action`) — auto/deliver/approve lanes + confluence
- Links: `tools/gen-links-registry.mjs` (`/api/links`) · Bug-hunt: `.claude/skills/bug-hunt`
- Open-core: `dashboard/premium.mjs` + `docs/OPEN-CORE-STRATEGY.md`
