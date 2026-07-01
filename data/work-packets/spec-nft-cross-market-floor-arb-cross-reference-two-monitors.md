# Work packet — NFT cross-market floor arb → cross-reference two monitors for a confluence alert

- **sig:** `spec:NFT cross-market floor arb → cross-reference two monitors for a confluence alert`
- **source avenue:** edge:nft-floor-arb
- **drafted:** 2026-06-30T19:03:00.141Z
- **routing (needs):** build
- **does it:** build (session)
- **score:** 38

## Goal
Turn two monitors firing on one asset into a single high-conviction alert.

## Concrete steps
1. Pick the two monitor templates to cross.
2. confluence() in execution.mjs already escalates ≥2 templates on one asset — confirm both are in the registry.
3. Tune the threshold; verify a real confluence card appears in the approve lane.

## Files likely involved
- `dashboard/execution.mjs`
- `config/monitors.json`

## Money gate
Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.

---
_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._
