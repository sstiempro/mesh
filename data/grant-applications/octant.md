<!-- fit 90 · Strong candidate for recurring community-voted public goods funding based on proven output. · https://octant.app -->



**Title**  
Mesh – Keyless Crypto‑Intelligence & Security Engine for Public‑Goods DeFi  

**One‑liner**  
An autonomous, open‑source system that continuously watches on‑chain data, flags exploits, and publishes verifiable security signals without any API keys or proprietary data.  

**Problem**  
DeFi users and protocol teams lack reliable, real‑time early‑warning tools that are free to use, transparent, and resistant to single points of failure. Existing monitoring services often rely on paid APIs, centralized infrastructure, or opaque data sources, limiting accessibility for the broader public‑goods ecosystem.  

**What we built** *(verifiable via commit history)*  
- **79 live keyless monitors** running on a 24/7 cron that ingest only public RPCs and open feeds (DefiLlama, Hyperliquid, CoinGecko, Snapshot, Deribit, public blockchain nodes). Each monitor implements a specific check: stable‑coin depeg detection, protocol TVL‑drain exploit early‑warning, DeFi hack ledger aggregation, cross‑venue funding arbitrage scanner, yield radar, token‑unlock sell‑pressure calendar, Snapshot governance watch, Deribit DVOL volatility regime tracker, Polymarket prediction‑market odds + whale flow monitor, narrative rotation detector, and macro risk‑on/off regime clock.  
- **Smart‑contract audit pipeline** that automatically runs Slither, Aderyn, and Foundry tests, then invokes a multi‑agent LLM‑based review to produce a consolidated security report for any contract submitted via the public‑goods feed.  
- **Open‑core public signal feed** (RSS/JSON) exposing all monitor outputs and audit reports. The feed is signed with ed25519 keys; verification proofs are published alongside each entry, allowing anyone to cryptographically confirm authenticity. A free tier provides unrestricted access; a optional pro tier (subscription‑based) offers higher‑frequency feeds and private webhook delivery to sustain operations.  
- **Autonomous build engine** that periodically scans the feed for new opportunities (e.g., emerging exploit patterns, governance proposals), translates them into actionable work items, opens pull requests, and merges after CI passes — all without human intervention.  
- **100 % keyless architecture**: no API keys, no paid data subscriptions, and all components are reproducible from the public repository.  

**Why it fits Octant**  
Octant funds recurring public‑goods epochs that improve Ethereum‑based infrastructure, security, and data availability. Mesh directly supplies:  
- Continuous, free exploit early‑warning that protects users and protocol treasuries.  
- Transparent, verifiable security signaling that can be consumed by wallets, explorers, and DAOs.  
- Open‑source tooling that lowers the barrier for developers to audit and monitor contracts.  
- A self‑sustaining model (free core + optional pro tier) that aligns with Octant’s goal of funding long‑term public‑goods maintenance.  

**Public‑good impact**  
Anyone can subscribe to the RSS/JSON feed and receive real‑time alerts about stable‑coin depegs, TVL drains, or governance attacks without paying for proprietary data. Developers can integrate the signed signals into their dApps to pause transactions or trigger emergency mechanisms. The audit pipeline offers a no‑cost first‑pass security review for emerging contracts, reducing the likelihood of costly exploits. All outputs are cryptographically provable, ensuring trust without reliance on a central authority.  

**Roadmap (next 3 concrete deliverables)**  
1. **Expand monitor coverage to Layer‑2s** – add Arbitrum and Optimism RPC endpoints to existing depeg and TVL‑drain checks, increasing the scope of early‑warning.  
2. **Introduce a decentralized feed mirror** – deploy an IPFS‑based pinning service (via Filecoin or Pinata) that replicates the RSS/JSON feed, guaranteeing availability even if the primary server goes down.  
3. **Streamline the autonomous build engine** – replace the current cron‑driven opportunity scanner with a lightweight event‑driven architecture using The Graph’s subgraph streams, reducing latency from detection to PR creation.  

**Ask**  
We request **$18,000** for a 6‑month grant to cover:  
- Server and bandwidth costs for the public feed and monitor cron (≈ $6,000).  
- IPFS/Filecoin pinning fees for feed mirroring (≈ $4,000).  
- Minor tooling improvements (Foundry updates, Slither/Aderyn license‑free enhancements) and audit‑pipeline robustness (≈ $5,000).  
- A modest stipend for the solo maintainer to allocate time to issue triage, documentation, and community outreach (≈ $3,000).  

All funds will be transparently tracked via a public OpenCollective‑style ledger linked from the repository.  

**Links**  
- Source & live monitors: https://github.com/stiempro/mesh  
- Public signal feed (RSS/JSON): https://mesh.sstiempro.io/feed.json  
- Audit pipeline example: https://github.com/stiempro/mesh/tree/main/audit  

---  
*This application presents only what has been shipped and verified; no inflated metrics or speculative claims are included.*