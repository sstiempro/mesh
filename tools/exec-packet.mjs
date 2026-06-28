#!/usr/bin/env node
// Execution packet generator — turns every income avenue into a PRE-FILLED, sequenced runbook so the
// operator's part collapses to identity clicks (email verify · wallet signature · KYC) — the only atoms
// an agent must not do (handling someone's keys/credentials = how wallets get drained). Everything else —
// research, application text, profile copy, device names, exact steps, ordering — is filled in here.
// Ordered by the MC's finding: FOUNDATIONS first (proven +20% median / +62% upside), then dominant core.
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = async (p)=>{ try{ return JSON.parse(await readFile(path.join(LAB,p),'utf8')); }catch{ return null; } };

const farm = await rd('config/farm-targets.json');
const fringe = await rd('data/fringe-mc.json');
const dom = (fringe?.dominant||[]).map(d=>d.name);

const md = `# Execution packet — pre-filled, your-clicks-only

> Generated ${new Date().toISOString().slice(0,10)}. **I did the homework; you do the identity click.** Every text field
> below is pre-written — copy/paste it. The only thing left for you is the part an agent must never do for you:
> verify an email, sign a wallet transaction, pass a KYC/captcha, choose a password. That line is what keeps your
> wallet from being drained by an agent holding your seed. Ordered by what the Monte-Carlo test proved wins.

---

## STEP 0 — Foundations first (the test proved these multiply everything: +20% median, +62% upside)

### 0.1 Basename (your onchain identity) — ~2 min
- Go to **base.org/names** → connect a fresh wallet → mint a name you'll keep (suggested: a clean handle, lowercase).
- **Your click:** approve the mint tx (small gas on Base). _Agent can't sign for you._
- Unlocks: Base Builder Rewards, every onchain play, Builder Score.

### 0.2 Build-in-public (push the repo public) — ~3 min
- On GitHub: make the \`cpu-miner-lab\` repo **public**. (FUNDING.yml + LICENSE + README are already in it.)
- **Your click:** GitHub → repo Settings → Change visibility → Public.
- Unlocks at once: Base Builder Rewards + Gitcoin + OP Retro + tea.xyz + GitHub Sponsors (one signal, five paths).

### 0.3 Farcaster account (proof-of-humanity) — ~3 min
- **farcaster.xyz** → sign up → link the same wallet. This Neynar PoH score boosts sybil-resistance across ALL farming.
- **Your click:** account creation + wallet link.

### 0.4 GitHub Sponsors — ~5 min · PRE-FILLED below
- Enable at **github.com/sponsors**. Paste this profile (edit the bracket):
\`\`\`
👋 I build open-source tooling for self-sovereign, keyless crypto infrastructure — including [Mesh],
an honest, hardware-protective dashboard for turning idle compute into safe, monitored income.
Sponsoring funds continued open-source development. Every tier is public-good work, no lock-in.
\`\`\`
- Edit \`.github/FUNDING.yml\` (already in the repo) — replace \`[OPERATOR-github-username]\` with your handle.
- **Your click:** enable Sponsors + the Stripe/identity step.

---

## STEP 1 — Passive builder-pay (set up once → pays automatically)

### Base Builder Rewards — full plan in docs/BASE-BUILDER-REWARDS-SETUP.md
- After 0.1–0.2: go to **builderscore.xyz**, connect wallet, verify GitHub, complete Human Checkmark.
- Target Builder Score ≥ 40 (public repos + onchain activity move it). Then it pays weekly, no claim.

### tea.xyz — ~5 min
- **tea.xyz** → register your public npm/JS packages (the dashboard's deps qualify) → verify via GitHub.
- **Your click:** GitHub OAuth + package registration.

---

## STEP 2 — Grants (the application is already WRITTEN: docs/grants/GRANT-APPLICATION.md)
- That file is a submission-ready grant for the dashboard (reusable across Gitcoin / OP Retro / Base / Octant).
- Fill the \`[OPERATOR]\` fields (your name, GitHub URL, wallet). Then submit:
  - **Gitcoin:** grants.gitcoin.co → Grants Stack → new project → paste the application.
  - **Optimism Retro:** atlas.optimism.io → create project → paste + complete KYC.
  - **Base:** docs.base.org/get-started/get-funded.
- **Your click:** submit + identity/KYC. _The writing is done._
- **Tell me your other projects and I'll write a grant for each one** (you build a lot — that's many non-dilutive shots).

---

## STEP 3 — Free passive streams (bandwidth on the mesh)
- \`cp config/depin.local.env.example config/depin.local.env\` → fill your Honeygain/EarnApp/Pawns logins.
- \`bin/depin-deploy.sh up\` → I deploy + monitor them across the mesh; earnings show on the Income page.
- **Your part:** create the DePIN accounts (email signup) + paste the tokens into the gitignored file. _I run the rest._

---

## STEP 4 — Fringe / drops (pre-prioritized; ~10 min/day cap)
The dominant-core the MC favors, in order — each is YOUR signup, but here's the exact pre-filled flow:
${(farm?.targets||[]).filter(t=>t.cat==='fringe'||t.cat==='quest'||t.cat==='node').slice(0,10).map(t=>`- **${t.name}** → ${t.url} — ${t.note?.slice(0,90)||''}`).join('\n')}
- **Your part:** the wallet/email signup per drop. **Cap total at ~10 min/day** (the research: more = a time-drain).

---

## STEP 5 — Skill (zero capital, AI co-pilots): audit contests + bounties
- **code4rena.com/competitive-audit** + **sherlock.xyz** + **cantina.xyz** → pick an active contest in scope you understand.
- **I co-audit with you** — paste the contract scope and I'll hunt vuln classes + draft the PoC + the finding report.
- **Your part:** create the platform account + submit the finding under your handle.

---

## What's ALREADY running autonomously (no action needed — verify on the dashboard)
- ⛏️ Mining · 🛰️ mesh health + auto-protect governor · 📊 yield/arb/pulse scanner · 📒 earnings ledger
- 🧪 all income functions on cadence (orchestrator) · 📰 daily intelligence brief (content engine)
- See the **Automation** panel + **/api/automation** for the live "everything is running" board.

## The one line I hold (and why it's for you, not against you)
I will not hold your seed phrase, sign wallet transactions, or create accounts as you. An agent that can do
those can also be tricked into draining you — that exact pattern is how people lose everything to a malicious
"airdrop." So I do 95%: all research, all the writing, all the automation, every form pre-filled. The final
identity click stays yours. That's not me being rigid — it's the one safeguard that makes all the rest safe.
`;

await mkdir(path.join(LAB,'docs'),{recursive:true});
await writeFile(path.join(LAB,'docs','EXECUTION-PACKET.md'), md);
console.log('wrote docs/EXECUTION-PACKET.md ('+md.length+' bytes) · dominant core:', dom.slice(0,4).join(', '));
