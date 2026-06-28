#!/usr/bin/env node
// Generate docs/SIGNUP-LINKS.md — THE definitive, prioritized, linked signup guide across every
// bi-product avenue we've built (foundations → free streams → airdrops → security/bounty → grants →
// audit supercharge). Pulls real URLs from the catalogues + adds the foundation accounts + the
// audit tooling. The operator works through it; he keeps every credential (the agent never needs them).
import { readFile, writeFile } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = async f => { try { return JSON.parse(await readFile(path.join(LAB,'config',f),'utf8')); } catch { return null; } };

// pull catalogue URLs
const urls = new Map();
const add = (name,url) => { if(url && /^https?:/.test(url) && !urls.has(url)) urls.set(url,name); };
for (const f of ['farm-targets.json','airdrop-radar.json','knowledge-capital.json','free-streams.json','system-plays.json','edge-mechanisms.json']) {
  const j = await rd(f); if(!j) continue;
  const arr = j.targets||j.airdrops||j.streams||j.plays||j.mechanisms||[];
  for (const x of arr) { const nm=x.name||x.id; for (const k of ['url','signup','checker_url','claim_url']) add(nm, x[k]); }
}

const T = (title, rows) => `\n## ${title}\n\n` + rows.map(r => `- [ ] **[${r[0]}](${r[1]})** — ${r[2]||''}`).join('\n') + '\n';

let md = `# Signup links — the definitive bi-product checklist

Everything to sign up for, prioritized. **You keep every credential.** The agent never needs your
passwords/keys — accounts run on your side, and any service API key goes in a gitignored local file you
fill. Work top-down: the FOUNDATIONS unlock the most for the least effort.

> ~${urls.size} unique platform links pulled from the catalogues + the foundations + audit tooling below.
`;

md += T('🥇 FOUNDATIONS — do these first (free, unlock the most)', [
  ['GitHub (you have it: sstiempro)','https://github.com/sstiempro','public repos = Builder Score + grants + Sponsors signal'],
  ['Enable GitHub Sponsors','https://github.com/sponsors','the Sponsor button (FUNDING.yml already set)'],
  ['Basename (onchain identity)','https://www.base.org/names','needed for Base Builder Rewards (~$1-2 gas)'],
  ['Builder Score / Talent Protocol','https://www.builderscore.xyz','verify GitHub → weekly ETH (no-claim) if score ≥40'],
  ['Farcaster (proof-of-humanity)','https://www.farcaster.xyz','boosts sybil-resistance across ALL airdrops'],
  ['Gitcoin (grants)','https://grants.gitcoin.co','submit the drafted grant for the mesh repo'],
  ['tea.xyz (OSS staking rewards)','https://tea.xyz','register your packages → passive'],
]);

md += T('🔐 SECURITY / BUG-BOUNTY — supercharge the audit (sign up to access scope + submit)', [
  ['Immunefi','https://immunefi.com','the biggest pool ($162M+); absorbing Code4rena'],
  ['Cantina','https://cantina.xyz','largest contests (Uniswap/EigenLayer); ongoing bounties'],
  ['HackenProof','https://hackenproof.com','200+ programs; 0xMarkets/Lendvest/Citrea live'],
  ['Sherlock','https://sherlock.xyz','audit contests + bounties'],
  ['Cyfrin CodeHawks','https://codehawks.cyfrin.io','contests + the Solodit findings DB'],
  ['Solodit (vuln pattern DB)','https://solodit.cyfrin.io','THE goldmine — every past audit finding, searchable'],
]);

md += T('💸 FREE STREAMS — zero capital (signup only)', [
  ['Honeygain','https://honeygain.com','idle bandwidth → cash'],
  ['EarnApp','https://earnapp.com','idle bandwidth (Bright Data)'],
  ['Pawns.app','https://pawns.app','idle bandwidth (IPRoyal)'],
  ['Grass','https://app.getgrass.io','bandwidth + GRASS airdrop'],
  ['Nodepay','https://app.nodepay.ai','bandwidth + NODE airdrop'],
  ['Lolli (BTC cashback)','https://lolli.com','free BTC on shopping you do anyway'],
  ['Coinbase Learn (learn-to-earn)','https://www.coinbase.com/learn','free tokens for quizzes'],
]);

// catalogue-pulled (airdrops + the rest), deduped, minus ones already listed above
const listed = new Set(['github.com','base.org','builderscore','farcaster','gitcoin','tea.xyz','immunefi','cantina','hackenproof','sherlock','codehawks','solodit','honeygain','earnapp','pawns','getgrass','nodepay','lolli','coinbase.com/learn']);
const rest = [...urls.entries()].filter(([u]) => ![...listed].some(s => u.includes(s)));
md += T('🪂 AIRDROPS + EVERYTHING ELSE — from the live catalogues', rest.map(([u,n]) => [n,u,'']));

md += `
## 🛠️ Audit supercharge — open-source tools that increase our odds (install, no signup)

| Tool | What it does | Repo |
|---|---|---|
| **Slither** | static analysis — catches 90+ vuln patterns fast | github.com/crytic/slither |
| **Aderyn** | Rust static analyzer (Cyfrin), fast + modern | github.com/Cyfrin/aderyn |
| **Echidna** | property/fuzz testing | github.com/crytic/echidna |
| **Medusa** | parallel fuzzer | github.com/crytic/medusa |
| **Foundry** | invariant + fuzz testing, the standard | github.com/foundry-rs/foundry |
| **Halmos** | symbolic testing | github.com/a16z/halmos |
| **Semgrep** | pattern-based code scanning | github.com/semgrep/semgrep |

**Practice repos to sharpen (free, increase odds):** Damn Vulnerable DeFi (tinyurl: damnvulnerabledefi.xyz) ·
Ethernaut (ethernaut.openzeppelin.com) · DeFiHackLabs (github.com/SunWeb3Sec/DeFiHackLabs — real exploit PoCs) ·
Solodit (every past finding = the pattern library).

**The supercharge logic:** tools (Slither/Aderyn) sweep for low-hanging fruit in seconds → AI (me) does the
deep logic/economic bugs tools can't see → Solodit tells us what's been found before (avoid duplicates, learn
patterns). Tools for breadth × AI for depth × Solodit for memory = the edge.

---
*You keep all credentials. The agent guides + builds + audits; you hold the accounts. Check items off as you go.*
`;

await writeFile(path.join(LAB,'docs','SIGNUP-LINKS.md'), md);
console.log('wrote docs/SIGNUP-LINKS.md ·', urls.size, 'catalogue links + foundations + security + tooling');
