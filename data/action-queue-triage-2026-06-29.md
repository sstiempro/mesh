# Action Queue Triage — June 29, 2026

**61 pending items.** Triaged by category and actionability.

## Summary

| Category | Count | Verdict |
|----------|-------|---------|
| Arb opportunities | 4 | 3 are data artifacts, 1 marginal |
| Stable yield (realistic) | 16 | Top 3 worth researching |
| Degen yield (>50% APY) | 32 | Skip — tiny pools, emissions, not sustainable |
| Other | 9 | Mixed |

## Arb Opportunities (4)

### FRAX at -0.902% discount
**SKIP.** The discount is less than 1%. Gas costs on Ethereum would eat 50%+ of the margin for any reasonable position. Only actionable with $100k+ capital on a low-gas chain. We don't have the capital.

### Ondo US Dollar Yield at +14% premium
**DATA ARTIFACT.** The monitor flagged a 14% *premium* (price > $1) as a buy opportunity. That's backwards — you'd short at premium, not buy. The monitor template assumes discounts. Flag for fix.

### LUSD at +0.7% premium / USUAL USD at +0.6% premium
**SKIP.** Tiny premiums, not actionable. Normal market noise.

## Stable Yield — Top 3 Worth Researching

### 1. Yearn Finance USDS — 55.6% APY (Ethereum)
**INVESTIGATE.** USDS is Sky/MakerDAO's new stablecoin. Yearn vaults auto-compound. 55% APY likely from SKY token emissions + lending yield. Probably real but decaying fast as TVL grows. Risk: smart contract risk (Yearn V3 + Sky), impermanent loss if USDS depegs, emission decay.

**Operator action:** Check vault TVL and age on yearn.fi. If TVL < $10M, yield is still fresh. If > $100M, yield is already diluted.

### 2. Morpho Blue Alpha USDT Prime — 43.2% APY (Hyperliquid L1)
**INVESTIGATE.** Morpho Blue is battle-tested lending. "Alpha" vaults are curated by risk managers. 43% on Hyperliquid is likely boosted by HYPE emissions. Real lending yield underneath.

**Operator action:** Check if it's HYPE emission-boosted. If yes, yield decays. If pure lending, it's sustainable.

### 3. Curve USDC-SUSDAT — 34.1% APY (Ethereum)
**INVESTIGATE.** SUSDAT = Saturn staked USDAT. Curve stable pool. 34% likely from CRV + Saturn emissions. Lower risk than degen but still emission-dependent.

**Operator action:** Check Saturn protocol age, audit status, and TVL depth.

### 4-8 (Lower Priority)
- gmtrade USDMXN-USDC (53.9%, Solana) — forex stable pair on Solana, likely GMTrade emissions
- gmtrade EUR-USDC (47.7%, Solana) — same
- saturn SUSDAT (38.1%, Ethereum) — same as #3 but different pool
- unitas SUSDU (37.2%, Solana) — newer protocol, higher risk
- curve-dex MSUSD-FXUSD (28.5%, Ethereum) — f(x) protocol stables, more complex

## Degen Yields (32 items) — SKIP ALL

Every item above 1000% APY is a tiny-TVL farming pool where:
- APY is calculated from emissions ÷ tiny TVL = absurd number
- Entering with any meaningful capital would crash the APY to near zero
- Many are paired with unknown/micro-cap tokens (NOCK, VELVET, PROS, DEUS)
- IL risk is extreme

These are noise. The monitor correctly detected them but they're not actionable.

## Monetization Path (the REAL value)

The action queue itself IS the product. These 61 items are a **yield radar feed** that can be:

1. **Published as a newsletter/API** — "$50+/mo yield intelligence subscription"
2. **Published as Farcaster frames** — daily yield radar posts
3. **Used in the Vibekit grant application** — the DeFi Scout agent surfaces exactly this data
4. **Packaged as an alert feed** — Telegram/webhook for depeg alerts and yield spikes

The data pipeline is already running. The operator just needs to set up the distribution channel.

## Action Items for Operator

1. [ ] Check Yearn USDS vault on yearn.fi (TVL, age, emission schedule)
2. [ ] Check Morpho Blue Alpha on Hyperliquid (emission vs lending yield)
3. [ ] Set up a simple yield-radar newsletter/Farcaster channel
4. [ ] Fix the arb monitor to distinguish buy-at-discount from short-at-premium
