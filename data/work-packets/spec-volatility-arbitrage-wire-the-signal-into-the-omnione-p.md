# Work packet — Volatility arbitrage → wire the signal into the omnione paper-sim as an entry gate

- **sig:** `spec:Volatility arbitrage → wire the signal into the omnione paper-sim as an entry gate`
- **source avenue:** edge:vol-arb
- **drafted:** 2026-06-30T13:33:59.889Z
- **routing (needs):** build
- **does it:** ai-crunch (omnione backtest)
- **score:** 49

## Goal
Wire this signal into the omnione paper-sim as an entry gate (cross-repo).

## Concrete steps
1. Expose the signal on /api/feed (keyless).
2. In ~/Developer/omnione, add a gate that reads the feed and only allows entries when the signal agrees.
3. Backtest with vs without the gate on the 27M-candle store (/backtest).
4. Keep paper-only — no live execution.

## Files likely involved
- `dashboard/execution.mjs`
- `~/Developer/omnione/services/strategy-engine`

## Money gate
Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.

---
_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._
