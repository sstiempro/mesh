---
name: bug-hunt
description: Smart-contract / web3 security audit + bug-bounty workflow for the mesh lab. Use when the operator points at an in-scope target (a contract, repo, protocol, or bounty program), asks to "audit", "hunt bugs", "find vulns", "run a security pass", "check this contract", "write a PoC", or "draft a bounty report" — or to triage which live bounty target to work next. Produces a tool-swept + manually-reasoned findings report ready for Immunefi/Cantina/Code4rena/HackenProof submission. Open methodology, private edge (the proprietary vuln-pattern ruleset is gated).
---

# bug-hunt — the supercharged audit pass

This is how we hunt. The edge is **tools × AI reasoning × memory of past exploits**, run in a fixed order so nothing is skipped and the high-payout classes get attention first. Open-core: the *method* below is public; the *proprietary vuln-pattern ruleset* lives in a gitignored Pro artifact and never ships to the public repo.

## 0. Boundaries (never violate)
- **Authorized scope only.** Only audit a target the operator has named AND that is in a public bounty/contest scope (Immunefi/Cantina/Code4rena/Sherlock/HackenProof/CodeHawks) or the operator's own code. No scanning random live contracts for exploitation.
- **Find + report, never exploit.** We write a PoC that *demonstrates* impact in a local fork/test env — we never execute against mainnet, never drain, never front-run a fix.
- **No credentials.** The operator holds all platform accounts. We prepare the report; the operator submits and signs.
- **Honest severity.** Map to the program's rubric. Don't inflate. A dup is a dup — say so.

## 1. Pick the target (triage)
Read `config/bounty-targets.json` → rank by `odds` × `prize_usd` ÷ crowd. Prefer **smaller prizes / newer programs / less crowd** (lower duplicate risk) over the $1M headline pools (saturated). Confirm the program is live and scope is open. Note `ends` (contests) and `access` (some need the operator's account first).

## 2. Recon
- Pull the in-scope source (the program links the repo/commit). Get the exact commit hash.
- Map the system: entry points, privileged roles, external integrations, money flows, upgrade mechanism.
- Note invariants the protocol *claims* (from docs/NatSpec) — bugs live where code breaks a stated invariant.

## 3. Tool sweep (seconds — catches the cheap stuff first)
**One command runs the whole sweep + triage:**
```bash
node tools/audit.mjs <git-url|local-path> [--commit <hash>] [--sub <subdir>] [--name <id>]
node tools/audit.mjs --target <bounty-id>   # pulls the repo from config/bounty-targets.json
node tools/audit.mjs --list                 # in-scope targets, ranked
```
It resolves the target (clones if a URL), finds in-scope `.sol` (skips deps/tests/mocks), runs **Slither**
(impact-filtered to High/Med, noise detectors dropped) **and Aderyn** (Cyfrin's AST analyzer — a complementary
detector set; in-scope-filtered + info detectors downgraded), runs the **high-signal pattern sweep** (tx.origin
auth, unprotected `initialize`, raw value-call before state, stale-oracle reads, missing access modifiers on
fund/admin functions, delegatecall/selfdestruct, ecrecover-replay, weak randomness), triages + dedupes by
severity, and writes a submission-draft to `data/audit-reports/<name>.{json,md}`. **Findings are LEADS, not
confirmed bugs** — each needs the manual pass (step 4) + a PoC (step 6) before submission.

The tool wraps these; run any directly to dig deeper. Triage output, discard noise:
- **Slither** — `slither . --exclude-dependencies` — 90+ detectors, reentrancy/access/uninitialized.
- **Aderyn** — `aderyn .` — Rust analyzer, complementary detector set.
- **Semgrep** — `semgrep --config p/smart-contracts` — pattern rules.
- (Fuzzing, when the bug class fits) **Echidna / Medusa** for invariants, **Foundry** `forge test` + **Halmos** for symbolic.
Tools find ~30% (the mechanical bugs). They miss the logic/economic bugs — that's the next step and where the real bounties are.

## 4. Manual vuln-class pass — **follow `docs/BUG-HUNT-METHODOLOGY.md` in order**
The detailed checklist lives in [docs/BUG-HUNT-METHODOLOGY.md](../../docs/BUG-HUNT-METHODOLOGY.md). Order is by payout density:
access-control → accounting/math → reentrancy → oracle/price → liquidation/lending → external-call/integration → DoS/griefing → signature/replay → upgrade/proxy.
For each: state the claimed invariant, then actively try to break it with a concrete sequence of calls.

**Apply the Pro ruleset if present.** Load it via the gate:
```js
import { proArtifact, isPro } from '../../dashboard/premium.mjs';
const ruleset = await proArtifact('audit'); // config/audit-pro.local.json (gitignored) — our accumulated private vuln patterns
```
If `ruleset` is null (free tier), run the open checklist only. If present, also sweep each private pattern. This is the open-core mechanism: public method, private accumulated edge.

## 5. Learn from history (the memory edge)
Before finalizing, cross-check against **Solodit** (https://solodit.cyfrin.io — every past audit finding, searchable) and **DeFiHackLabs** (real exploit PoCs):
- Has this exact bug class been reported on this protocol or a fork of it? (dedup — saves a wasted submission)
- Does a known exploit pattern apply to this code? (pattern-match the win)

## 6. PoC
Write a minimal **Foundry** test on a local fork that demonstrates the impact (state change, fund movement, locked funds, broken invariant). Local only. The PoC *is* the report's credibility.

## 7. Report → log
Draft the submission to the program's format. Per finding capture (matches `config/bug-findings.json` schema):
`id, date, target, severity, class, title, function, description, impact, fix, status, bounty`.
Append to `config/bug-findings.json`. The operator reviews + submits.

## Honest priors (set expectations, every time)
- First valid bounty is **weeks-to-months**, not days. Most passes find nothing submittable. That's the job.
- Crowded contests = high dup rate; a "valid" finding someone else filed first pays you $0.
- The realistic early win is a **low/medium on a small or newer program**, not a crit on Uniswap.
- EV is real and compounding (each pass sharpens the private ruleset in step 4), but it is a skill flywheel, not a faucet.

## Wired into the system
- Targets: `config/bounty-targets.json` · Findings: `config/bug-findings.json` · Method: `docs/BUG-HUNT-METHODOLOGY.md`
- Live on the dashboard: `/api/bounties` (open targets + gated Pro ruleset status) · `/api/links?type=signup` (platform signups)
- Open-core gate: `dashboard/premium.mjs` + `docs/OPEN-CORE-STRATEGY.md`
