# Work packet — Wallet bundle/health scanner → turn the output into a daily auto-posted thread (attention → audience)

- **sig:** `spec:Wallet bundle/health scanner → turn the output into a daily auto-posted thread (attention → audience)`
- **source avenue:** system:sp36
- **drafted:** 2026-06-30T08:06:12.000Z
- **routing (needs):** content
- **does it:** operator (post)
- **score:** 57

## Goal
Auto-compose a daily thread from this signal (attention → audience).

## Concrete steps
1. digest() in execution.mjs already builds ≤270-char thread chunks — wire this signal type in.
2. Draft is auto-generated each tick to data/digest-latest.md.
3. OPERATOR posts it (publishing is an operator action) to X/Farcaster/Mirror.

## Files likely involved
- `dashboard/execution.mjs`
- `data/digest-latest.md`

## Money gate
Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.

---
_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._
