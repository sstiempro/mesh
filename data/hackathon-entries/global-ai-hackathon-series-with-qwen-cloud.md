<!-- fit 90 · Machine Learning/AI and Productivity themes fit with autonomous monitor generation · https://qwencloud-hackathon.devpost.com/ -->

### Title
Mesh: Autonomous Keyless Crypto-Intelligence and Security Engine

### One-liner
Mesh is an open-source, autonomous crypto-intelligence engine that provides real-time monitoring and security alerts for the DeFi ecosystem, leveraging machine learning and AI to identify potential exploits and risks.

### Problem
The DeFi ecosystem is prone to exploits, hacks, and market volatility, resulting in significant financial losses for users. Current solutions often rely on proprietary data sources, manual monitoring, and limited scalability. There is a need for an autonomous, open-source, and keyless solution that can provide real-time intelligence and security alerts to the DeFi community.

### What we built
Mesh is a shipped and running system with a public commit history on GitHub ([github.com/sstiempro/mesh](http://github.com/sstiempro/mesh)). The system includes:
* ~98 live keyless monitors running on a 24/7 cron job, providing early warnings for stablecoin depeg, protocol TVL-drain exploits, and other market risks
* An autonomous capability-generation engine (`monitor-forge.mjs`) that discovers new opportunity categories, writes new monitors using an LLM, and ships them live with zero human intervention
* A smart-contract audit pipeline using Slither, Aderyn, and Foundry for public-goods security
* A multi-chain wallet supporting EVM, Solana, Bitcoin, Cosmos, Sui, Aptos, and Near addresses derived from a single seed
* An open-core public signal feed (RSS/JSON) with a free tier for the commons and a pro tier for sustainability

### Why it fits this hackathon's themes
Mesh aligns with the Machine Learning/AI theme by leveraging an LLM to write and ship new monitors autonomously. It also fits the Design theme by providing a user-friendly and accessible signal feed for the DeFi community. Additionally, Mesh contributes to the Productivity theme by automating the monitoring and security alert process, reducing the need for manual intervention and increasing the efficiency of DeFi users.

### Tech stack
Mesh is built using a variety of technologies, including JavaScript, Node.js, and machine learning libraries. The system utilizes public data sources such as DefiLlama, Hyperliquid, CoinGecko, and Snapshot, ensuring that all data is reproducible and free from proprietary moats.

### Links
* GitHub repository: [github.com/sstiempro/mesh](http://github.com/sstiempro/mesh)

### What's left to do before submitting
Before submitting, we need to:
* Review the eligibility rules to ensure compliance
* Confirm that the existing system's output can be wired into the hackathon's track without requiring a custom build
* Ensure that all information provided is accurate and honest, without inventing metrics, users, demo videos, or team members that do not exist.