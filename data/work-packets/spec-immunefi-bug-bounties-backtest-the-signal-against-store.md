# Work packet — Immunefi bug bounties → backtest the signal against stored candle history for an edge stat

- **sig:** `spec:Immunefi bug bounties → backtest the signal against stored candle history for an edge stat`
- **source avenue:** system:sp1
- **drafted:** 2026-06-30T18:30:55.922Z
- **routing (needs):** ai-crunch
- **does it:** ai-crunch (omnione)
- **score:** 40

## Goal
Backtest this signal against stored candle history for a real edge stat.

## Concrete steps
1. Define the signal as a strategy in omnione simulation-engine.
2. POST /backtest then /backtest/forward (in-sample/OOS split) on the 27M-candle store.
3. Report Deflated-Sharpe + dollars-from-$100; promote only if it survives the null gate.

## Files likely involved
- `~/Developer/omnione/services/simulation-engine`

## Money gate
Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.

---
_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._
