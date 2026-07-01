# Work packet — Lending-rate arb → expose as a public read-only API endpoint + rate-limit

- **sig:** `spec:Lending-rate arb → expose as a public read-only API endpoint + rate-limit`
- **source avenue:** edge:lending-rate-arb
- **drafted:** 2026-06-30T20:46:07.176Z
- **routing (needs):** build
- **does it:** build (session)
- **score:** 36

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
