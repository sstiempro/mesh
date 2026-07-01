# Work packet — Real-yield data feed → package as a paid webhook feed (open-core: free digest, pro realtime)

- **sig:** `spec:Real-yield data feed → package as a paid webhook feed (open-core: free digest, pro realtime)`
- **source avenue:** system:sp11
- **drafted:** 2026-06-30T05:37:49.577Z
- **routing (needs):** build
- **does it:** build (session)
- **score:** 61

## Goal
Ship this signal as an open-core feed (free digest + pro realtime webhook).

## Concrete steps
1. Confirm the source monitor fires (dashboard/monitors.mjs) and emits an alert shape.
2. Route it through execution.mjs deliver() so it lands in the public-feed (already wired).
3. Gate a pro realtime tier behind premium.mjs (ed25519 license) → config/delivery.local.json webhook.
4. Document the endpoint + tiers in the Earn/Signals tab.

## Files likely involved
- `dashboard/execution.mjs`
- `dashboard/premium.mjs`
- `dashboard/server.mjs`

## Money gate
Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.

---
_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._
