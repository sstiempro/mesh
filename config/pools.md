# Coin + pool picker

Set `pools[0]` in `config/xmrig.json`. You only ever paste a **public receive address** here.

## Monero (XMR) — default, deepest liquidity
- Generate a wallet: official **Monero GUI/CLI**, **Feather** (light, recommended), or **Cake Wallet** (mobile).
  Use the **primary public address** (starts with `4...`). Keep your seed offline.
- Pool: **supportXMR**
  - `url`: `pool.supportxmr.com:3333`  (low-diff port, good for a slow CPU)
  - `tls`: `false`  (use `:9000` + `tls:true` if you want TLS)
  - `algo`: `rx/0`, `coin`: `monero`
  - Min payout is lowerable in the supportXMR dashboard (default 0.1 XMR).
- Later upgrade: **P2Pool** (trustless, 0% fee, pays per block) — needs a local `monerod` + `p2pool`. Use the
  **mini** sidechain for low hashrate.

## Verus (VRSC) — max ASIC-resistance, also CPU-friendly
- Different algorithm (VerusHash), so it needs the **Verus miner** (`ccminer`/`verus` build), not xmrig.
  Keep this as a phase-2 option; xmrig covers Monero/Zephyr now.
- Wallet: **Verus Desktop**. Pool: **luckpool** (`na.luckpool.net:3956`).

## Zephyr (ZEPH) — RandomX fork, mines on the same xmrig
- Swap `coin` to `zephyr`, `algo` stays `rx/0`-family per the pool's instructions.
- Pool: e.g. `pool.miningocean.org` / `herominers` Zephyr ports. Wallet from the Zephyr CLI.

## Switching coins
Edit `config/xmrig.json` pool block, then `./bin/stop.sh && ./bin/start.sh`. No rebuild needed for
RandomX coins (Monero/Zephyr). Verus needs its own miner binary.
