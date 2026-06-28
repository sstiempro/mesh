# Platform Plan — the real UI (web subdomain + desktop app + CLI)

Goal: replace the localhost stub with a **real, always-on control plane** — accessible anywhere via a
subdomain on your custom domain, ALSO shipped as a non-Electron desktop app, with the VPS running it 24/7
and owned computers joining when available. Supercharged from proven repos, then skinned/optimized.

## Topology (who does what)
```
                    Caddy (auto-HTTPS, auth)  ──►  mining.YOURDOMAIN.com   ← access anywhere
  ┌──────────────── VPS = CONTROL PLANE (coordination, NOT hashing) ─────────────────┐
  │  • xmrig-proxy (one pool connection, holds wallet, tailnet-bound)                 │
  │  • control panel  (dashboard/server.mjs → evolves into the fleet API)            │
  │  • Grafana + Prometheus + xmrig-exporter  (metrics/viz)                          │
  │  • XMRigCC-Server (optional: remote start/stop/reboot/config + Telegram alerts)  │
  └──────────────────────────────────────────────────────────────────────────────────┘
        ▲ report in                         ▲ report in
  ┌─────┴──────┐                      ┌──────┴───────┐
  │ Mac M1     │  xmrig (guarded)     │ spare Linux  │  xmrig (load-gated)   ← OWNED HW = the hashers
  └────────────┘                      └──────────────┘
  Desktop app (Tauri) and CLI both just point at mining.YOURDOMAIN.com.
```

## The stack (researched, proven — don't reinvent)
| Layer | Tool | Repo / note |
|---|---|---|
| Secure public entry | **Caddy** | auto-HTTPS + subdomain + `basic_auth` (or Authelia for MFA) |
| Metrics + viz | **Grafana + Prometheus + xmrig-exporter + node-exporter** | github.com/leonardochaia/xmrig-monitoring (docker-compose, prebuilt dashboards) |
| Fleet control + alerts | **XMRigCC** (optional spine) | github.com/Bendr0id/xmrigCC — remote start/stop/reboot/config, Telegram/PushOver |
| Custom control + treasury | our `dashboard/` | evolve server.mjs → fleet API (routing, start/stop, XMR+BTC balances) |
| Desktop app (NOT Electron) | **Tauri 2** | v2.tauri.app — native webview, ~3MB .dmg/.app, wraps the same web UI |
| Terminal | our `bin/status.sh` (+ future TUI) | already works |

## Spine choice (decide once)
- **Option A — XMRigCC spine:** most "supercharge with a repo." Remote control + alerts + multi-OS out of
  the box. Trade-off: each node runs the **XMRigCC miner fork** (rebuild), and the UI is functional-but-dated.
- **Option B — vanilla xmrig + custom panel (current):** we already built vanilla xmrig 6.26 + a clean
  dashboard. Evolve `server.mjs` into the fleet API; use **Grafana** for the heavy viz. More control, cleaner
  UI, more "build/upgrade/enhance." **← recommended** (lean on Grafana for viz, custom for actions+treasury).

## Security (public exposure = must)
- Caddy terminates HTTPS; panel sits behind `basic_auth`/Authelia. **Only the dashboard is exposed** — never
  the miners' APIs or the wallet. xmrig-proxy stays **tailnet-bound**.
- VPS runs the **control plane only** — never the hashing process (ToS + it's the CPU-starved trading box).
- Wallet = public address only, lives on the coordinator. No keys anywhere else.

## Build order
1. **Phase 1 — mine (now):** vanilla xmrig on the Mac. *Blocked only on your wallet address.*
2. **Phase 2 — always-on subdomain:** Caddy on the VPS → `mining.YOURDOMAIN.com` (HTTPS + login) → control
   panel + Grafana. This is the "access anywhere, 24/7" piece.
3. **Phase 3 — fleet API:** evolve `server.mjs` to aggregate all nodes (per-node + totals + XMR/BTC treasury)
   and expose start/stop/route controls.
4. **Phase 4 — desktop app:** Tauri shell wrapping the web UI → `.dmg`. Non-Electron, opens like a native app.
5. **Phase 5 — alerts + optimize:** Telegram on hashrate-drop/offline; profit comparator (MoneroOcean vs
   NiceHash live $/day) to auto-route nodes.

## Honest note
This is clean engineering and genuinely useful ops — but the dashboard doesn't change the yield ceiling
(small, per earlier math). Build it because you want a real always-on system + the BTC-lottery lane, not
because the UI mints money. The platform's real payoff is control, visibility, and easy scaling of nodes.
