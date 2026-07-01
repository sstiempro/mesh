# Arbitrum Trailblazer 2.0 — Grant Application Draft

**Submit at:** https://docs.google.com/forms/d/e/1FAIpQLSe-GF7UcUOuyEMsgnVpLFrG_W83RAchaPPqOCD83pZaZXskgw/viewform
**Amount:** Up to $10,000
**Status:** OPEN (no stated deadline)

---

## Project Name

**Mesh DeFi Scout** — an autonomous DeFi opportunity scanner agent for Arbitrum

## Project Description

Mesh DeFi Scout is a Vibekit-powered autonomous agent that continuously monitors the Arbitrum DeFi ecosystem for yield opportunities, funding rate anomalies, and risk events. It runs on your machine, uses your keys, and surfaces actionable intelligence — no cloud dependency, no API keys required.

The agent wraps 6 production-tested keyless monitors (yield, funding rates, gas, sentiment, TVL drain detection, and stablecoin depeg alerts) as Vibekit MCP tools. It integrates with Pendle, GMX, Aave, and Camelot via Vibekit's onchain-actions to execute strategies like:

- **Yield optimization:** Scan and compare APYs across Arbitrum protocols, auto-deposit into the highest-risk-adjusted yield
- **Funding rate arbitrage:** Detect abnormal funding rates on GMX perpetuals and alert when delta-neutral carry is profitable
- **Risk monitoring:** Real-time alerts for TVL drops >5%, stablecoin depegs, and gas spikes
- **Daily DeFi brief:** Generates a publishable intelligence report summarizing Arbitrum DeFi state

All data sourced from public, keyless APIs (DefiLlama, CoinGecko, alternative.me, exchange public endpoints). The agent is fully local — your keys never leave your machine.

## What category does your project fit?

- [x] Autonomous agents executing profitable or innovative strategies on Arbitrum DeFi
- [x] Shareable agent templates and blueprints
- [x] Tooling or services integrating with agents

## How does it use Vibekit?

The agent is built as a Vibekit agent template (`typescript/community/agents/defi-scout/`). It uses:

1. **agent-node** for the core agent loop and natural language interface
2. **MCP tools** wrapping the 6 keyless monitors as Model Context Protocol servers
3. **ember-onchain-actions** for executing swaps, deposits, and claims on Pendle/GMX/Aave/Camelot
4. **Skills framework** for modular capabilities: `yield-scan`, `funding-arb`, `risk-monitor`, `daily-brief`
5. **Workflows** for multi-step strategies (e.g., "find best yield → check risk → deposit → set exit alert")

## What makes it unique?

1. **Keyless-first:** Every data source is public/free. No Alchemy keys, no Dune API keys, no exchange accounts. Works out of the box.
2. **Battle-tested monitors:** The underlying monitoring engines have been running in production for 6+ months, processing real DeFi data 24/7.
3. **Publishable output:** The daily brief isn't just for the operator — it's formatted for publishing to newsletters, Farcaster, Mirror, or X, creating a distribution channel for the Arbitrum ecosystem.
4. **Risk-first:** Every opportunity includes risk scoring (TVL stability, protocol age, audit status, smart contract risk) before suggesting action.

## Impact on Arbitrum ecosystem

- **User education:** Daily briefs explain what's happening across Arbitrum DeFi, bringing new users in
- **Liquidity routing:** Surfaces underappreciated yield opportunities, improving capital efficiency
- **Risk monitoring:** Early warning for depegs, TVL drains, and protocol issues protects users
- **Template value:** Other developers can fork and extend the template for their own strategies

## Team / Builder

Solo builder with deep experience in quantitative trading systems, autonomous agents, and DeFi infrastructure. The monitoring engine this agent wraps processes data across 100+ crypto assets and has been running continuously for 6+ months.

- GitHub: [OPERATOR TODO: add GitHub profile URL]
- Agent wallet: 0xYOUR_WALLET (Arbitrum)
- Existing deployed work: live keyless monitoring feed, 9 autonomous crons, security audit pipeline

## Deliverables

1. Vibekit agent template published to `community/agents/defi-scout/`
2. 6 MCP tool wrappers for the monitoring engines
3. 4 skills: yield-scan, funding-arb, risk-monitor, daily-brief
4. 2 workflows: yield-optimizer, risk-alert-and-exit
5. Documentation and usage guide
6. Live demo running on Arbitrum

## Timeline

- Week 1: Vibekit template scaffolding + MCP tool wrappers for all 6 monitors
- Week 2: Skills and workflows implementation + Arbitrum onchain integration
- Week 3: Testing, documentation, live demo, submission to Vibekit community

---

## OPERATOR ACTION NEEDED

1. Fill in your GitHub profile URL
2. Fill in your name/contact
3. Submit at the Google Form link above
4. The template build work can start immediately — `npx @emberai/agent-node@latest init` in a new directory
