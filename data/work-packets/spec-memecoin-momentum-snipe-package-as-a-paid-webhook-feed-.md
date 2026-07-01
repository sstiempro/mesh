# Work packet — Memecoin momentum snipe → package as a paid webhook feed (open-core: free digest, pro realtime)

- **sig:** `spec:Memecoin momentum snipe → package as a paid webhook feed (open-core: free digest, pro realtime)`
- **source avenue:** edge:meme-momentum-snipe
- **drafted:** 2026-06-30T07:54:20.779Z
- **routing (needs):** build
- **does it:** build (session)
- **score:** 58

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
