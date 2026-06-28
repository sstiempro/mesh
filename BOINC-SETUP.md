# Gridcoin / BOINC — the VPS earns, legitimately

BOINC runs real scientific computation (protein folding, astronomy, cancer research); **Gridcoin (GRC)**
rewards it. It is **not PoW mining** → allowed on Contabo/OVH VPS. Throttled so it only uses spare CPU and
auto-suspends when the box is busy — it won't fight the trading platform.

## Done
- `bin/setup-boinc-vps.sh` — installs + throttles BOINC on a Linux box.
- **contabo:** installed + throttled (≤30% CPU, ≤50% cores, suspends when busy). Daemon running.
- Dashboard shows a **BOINC (useful-work)** panel with the VPS status.

## To start earning GRC (your step — free, ~5 min, no spend, no keys to me)
1. Create a free account at **grcpool.com** (pool mode = no Gridcoin wallet or beacon needed; the pool pays GRC).
2. grcpool gives you a project URL + a **weak account key** (safe to use for attaching — not a password).
3. Attach BOINC on each box:
   ```
   ssh root@<box>           # contabo: VPS_IP
   cd /var/lib/boinc-client
   boinccmd --project_attach https://grcpool.com/ <your-weak-account-key>
   boinccmd --get_simple_gui_info   # should show tasks downloading
   ```
4. BOINC pulls work → computes (throttled) → grcpool credits you GRC.

> Prefer no pool? Attach directly to a project (e.g. World Community Grid, Rosetta@home) and link your CPID
> to a Gridcoin beacon. More setup; pool mode is the easy path.

## Roll it to the whole fleet
Run `setup-boinc-vps.sh` on **ovh** too, and (optionally, throttled) on the Macs. Attach all to one grcpool
account → **one GRC payout for your entire fleet doing useful work — within every provider's rules.**

## Honest economics
GRC is a small coin: expect **cents/day**. The win is that the VPS finally earns *something* legitimately
and the compute does real science. Convert GRC → BTC/XMR on an exchange when worthwhile.
