<!-- fit 90 · Technical and open-source funding for tooling, infra, and research aligns with mesh's open-source and security focus · https://grants.web3.foundation -->

# Grant Application: mesh

### Title
mesh: An autonomous, keyless crypto-intelligence and security engine.

### One-liner
An open-source, 24/7 autonomous engine that transforms public data into actionable security alerts, DeFi intelligence, and automated smart contract audits.

### Problem
The Web3 ecosystem suffers from information asymmetry and delayed reaction times. Security exploits often go unnoticed by retail users until funds are gone, and high-quality DeFi intelligence (liquidations, depegs, governance shifts) is typically gated behind expensive, proprietary SaaS platforms. Furthermore, the infrastructure required to monitor these cross-chain signals usually relies on centralized API keys or manual human intervention, creating single points of failure and high operational overhead.

### What we built
`mesh` is a shipped, functional, and verifiable autonomous system (70+ public commits). It operates on a 100% keyless architecture, utilizing public RPCs and open data sources (DefiLlama, Hyperliquid, Snapshot, etc.) to ensure reproducibility.

**Core Artifacts:**
*   **79 Live Monitors:** A 24/7 cron-based system tracking stablecoin depegs, protocol TVL drains, cross-venue funding arbitrage, and Polymarket whale flows.
*   **Autonomous Security Pipeline:** An integrated audit workflow using Slither, Aderyn, and Foundry, augmented by a multi-agent review process for rapid public-goods security assessment.
*   **Signal Distribution:** An open-core feed (RSS/JSON) utilizing ed25519 licensing for forge-proof integrity.
*   **The Build Engine:** A "no-human-in-the-loop" architecture that autonomously discovers data anomalies, processes them into work units, and broadcasts the output.

### Why it fits Web3 Foundation Grants
`mesh` aligns with the W3F mission of supporting decentralized, open-source infrastructure and tooling. 
1.  **Technical Depth:** It is a pure software play focused on data availability and security tooling.
2.  **Open Source:** The entire engine is public, allowing others to fork, verify, and run their own intelligence nodes.
3.  **Keyless/Permissionless:** By avoiding proprietary data moats, `mesh` demonstrates how to build robust infra using only the public commons.
4.  **Polkadot/Substrate Synergy:** The architecture is designed to ingest and monitor Substrate-based chains and XCM activity, providing the same security "early-warning" systems currently active for EVM and Hyperliquid.

### Public-good impact
The primary impact is **user protection**. By providing a free tier for exploit early-warnings and protocol health monitors, `mesh` reduces the "dark forest" advantage held by sophisticated actors. The automated audit pipeline acts as a public-goods security layer, scanning newly deployed or popular contracts to flag vulnerabilities before they are exploited. Because the project is solo-built and independent, it serves as a neutral observer in the ecosystem.

### Roadmap
1.  **Substrate/Polkadot Integration:** Expand the monitor suite to include Polkadot/Kusama parachain health, XCM message congestion, and governance proposals (1 month).
2.  **Headless Node Distribution:** Package the engine into a Dockerized "one-click" deployment so users can run their own private `mesh` instance locally (2 months).
3.  **Formal Verification Integration:** Incorporate automated formal verification (HEVM/Kontrol) into the existing audit pipeline to move beyond static analysis (3 months).

### Ask
**$15,000 USD**
This grant will fund:
*   6 months of infrastructure costs (RPC providers, compute for the 24/7 engine).
*   Development time for the Substrate/Polkadot integration.
*   Maintenance of the open-source codebase and public signal feeds.

### Links
*   **GitHub:** [https://github.com/sstiempro/mesh](https://github.com/sstiempro/mesh)