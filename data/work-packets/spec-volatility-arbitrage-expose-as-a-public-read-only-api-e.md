# Work packet — Volatility arbitrage → expose as a public read-only API endpoint + rate-limit

- **sig:** `spec:Volatility arbitrage → expose as a public read-only API endpoint + rate-limit`
- **source avenue:** edge:vol-arb
- **drafted:** 2026-06-29T15:21:52.320Z
- **routing (needs):** build
- **does it:** build (session)
- **score:** 69

## Goal
Expose this monitor as a public read-only, rate-limited API endpoint.

## Concrete steps
1. Add a GET /api/<signal> route in server.mjs reading the monitor output.
2. Add a simple per-IP rate limit.
3. Document it as a free-tier read; reserve realtime for pro.

## Files likely involved
- `dashboard/server.mjs`

## Money gate
Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.

---
_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._
