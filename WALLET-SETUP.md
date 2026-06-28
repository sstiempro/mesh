# Wallet setup — own it, never expose the keys

Goal: a **dedicated wallet for the mining take** that everything pays into, that YOU fully control, and that
you later sweep to Binance. The dashboard watches the balance but can NEVER spend.

## The one hard rule
**Private keys / seed phrase NEVER go on the VPS, in the dashboard, in a config, in git, or in chat.**
The panel runs on an internet-exposed box — if spend keys lived there and the box were breached, the funds
are gone in one transaction. So we split it: spend power stays offline with you; the server only *watches*.

## How it's wired
```
miners ──pay──► PUBLIC ADDRESS  (safe to share; lives in pool/proxy config)
                     │
                     ├──► dashboard reads balance via MONERO VIEW-KEY (read-only, cannot spend)
                     │
                     └──► YOU sweep to Binance from the wallet app, with the SPEND key, offline
```

## Do this (you, ~10 min — I never see keys)
1. **Create the wallet you control.** Pick one:
   - **Cake Wallet** (mobile/desktop) — holds **both Monero (XMR) and Bitcoin (BTC)** in one app. Best fit
     since we mine XMR and the BTC/NiceHash lane pays BTC. Write the seed on paper, store it offline.
   - or **Feather** (XMR desktop) + any BTC wallet, if you prefer separate.
2. **Give me only the public pieces:**
   - the **XMR primary address** (`4...`) → goes in the coordinator/pool config for payouts.
   - the **BTC receive address** (`bc1...`) → for the NiceHash/solo-BTC lane.
   - (optional, for live balance on the dashboard) the **Monero secret VIEW KEY** + address. The view key is
     **read-only** — it reveals incoming funds but cannot move them. Only share it if you want the balance
     tile; the dashboard otherwise uses the pool API.
3. **Later: cash out yourself.** From Cake/Feather (with your spend key), send to your **Binance deposit
   address**. I never initiate transfers — moving real funds is always your action.

## What I will and won't do
- ✅ Put your **public address** in the pool/proxy config; show balances read-only; help you verify payouts.
- ❌ Generate, request, store, or transmit any **seed phrase or spend/private key**. ❌ Initiate any transfer.

> Note: a Monero **view key** still deserves care (it deanonymizes your incoming history) — share it only if
> you want on-dashboard balances; it can never spend, but treat it as sensitive.
