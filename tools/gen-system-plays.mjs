#!/usr/bin/env node
// Generate config/system-plays.json — 100 ways to make money by LEVERAGING OUR SYSTEM (the dashboard,
// the keyless scanners, the multi-chain wallet, the mesh, the quant/backtest engines, AI reasoning).
// Theme the operator asked for: bug-bounty/skill plays + data products + monitoring + tools + niche
// services across crypto/blockchain/wallet/dashboard/fintech + adjacent. Each: what OUR system does,
// how it pays, effort, capital, ai_leverage, buildable, market. Generated as a ranked catalogue.
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let N=0;
const P = (name, cat, system, pays, o={}) => ({ id:'sp'+(++N), name, cat, system, pays,
  effort:o.e||'med', capital:o.c||0, ai:o.ai!==false, buildable:o.b||'yes', market:o.m||'', ...o });

const T = [
  // ── security / audit / bug-bounty (skill + AI → big bounties) ──
  P('Immunefi bug bounties','security','AI co-audits live contracts for vuln classes + writes the PoC','single crit $10k–$1M+ (pool >$162M)',{e:'high',b:'yes',m:'$162M+ available'}),
  P('Code4rena/Sherlock/Cantina contests','security','systematic AI-assisted audit of contest scope','$5k–50k/contest by valid findings',{e:'high'}),
  P('HackenProof / web3 programs','security','broader program surface, AI triages','steady small-med payouts',{e:'high'}),
  P('Audit-as-a-service (indie)','security','AI-assisted pre-audit for small projects before they pay big firms','$500–5k/engagement',{e:'high',m:'underserved long tail'}),
  P('Exploit early-warning monitor','security','watch mempool/contracts for known attack patterns → alert protocols','retainer / bounty for the heads-up',{e:'high',b:'partial'}),
  P('Rug/scam detector API','security','score new tokens for honeypot/rug patterns (we catalogue these)','API subscription / lead-gen',{m:'retail protection'}),
  P('Phishing/drainer site reporter','security','detect malicious airdrop/claim sites → bounties from chains/wallets','per-report bounty',{b:'partial'}),
  P('Smart-contract diff watcher','security','alert on risky upgrades/proxy changes to subscribed protocols','monitoring retainer',{}),
  P('Invariant/fuzz harness builder','security','AI writes Foundry invariant tests for projects','per-project fee',{e:'high'}),
  P('Wallet-drainer forensics','security','trace stolen funds, write the incident report','forensics fee / bounty',{e:'high'}),

  // ── data products (sell what our keyless scanners already collect) ──
  P('Real-yield data feed','data','yields() ranks organic vs emissions across 15k pools','API / data subscription',{m:'funds + researchers'}),
  P('Sentiment/pulse API','data','worldPulse() F&G + regime + cross-asset','API subscription',{}),
  P('Airdrop-radar feed','data','the auto-discovery + eligibility engine, as a product','subscription / affiliate',{m:'huge airdrop audience'}),
  P('Arb/spread data','data','cross-exchange + triangular spreads, net of fees','quant/desk subscription',{}),
  P('Curated datasets for AI','data','clean labeled crypto datasets from our pipelines','sell on HuggingFace/marketplaces',{}),
  P('Persistence/“is it real” scores','data','our null-calibration + persistence layer as a trust score','API',{ai:true}),
  P('DePIN earnings benchmark','data','anonymized mesh/DePIN $/device data','report / dataset',{}),
  P('Onchain-history scorer','data','wallet activity → airdrop-eligibility likelihood score','API / B2B',{}),
  P('Liquidation-risk feed','data','positions near liquidation across lending protocols','desk subscription',{b:'partial'}),
  P('Stablecoin depeg monitor','data','keyless price + peg deviation alerts','API / alerts',{}),

  // ── monitoring / alerts as a service ──
  P('Wallet watchtower','monitor','keyless balance/tx monitor across our 4 ecosystems','per-wallet subscription',{m:'whales + funds'}),
  P('Governance/proposal alerts','monitor','watch DAO proposals affecting held assets','subscription',{}),
  P('Unlock/vesting calendar alerts','monitor','token unlock schedules → price-risk alerts','subscription',{}),
  P('Bridge/exploit status alerts','monitor','protocol health + incident alerts','retainer',{}),
  P('Gas/fee optimizer alerts','monitor','best time/chain to transact','freemium app',{}),
  P('Yield-change alerts','monitor','notify when a position’s APY drops or a better one appears','subscription',{}),
  P('Airdrop-deadline alerts','monitor','our radar’s never-miss deadline engine, productized','freemium + affiliate',{}),
  P('Portfolio drift/rebalance alerts','monitor','multi-chain balance reads → drift detection','subscription',{}),
  P('Whale-move alerts','monitor','track flagged addresses → copy/sentiment signal','subscription',{}),
  P('Node/validator downtime alerts','monitor','mesh-health style monitor for node operators','per-node fee',{}),

  // ── tools / micro-SaaS / checkers ──
  P('Airdrop eligibility checker','tools','paste-address multi-chain checker (we have the wallet reads)','freemium + affiliate',{m:'massive search volume'}),
  P('Impermanent-loss calculator','tools','LP IL + fee-vs-hold calculator','ads / freemium',{}),
  P('Crypto tax helper','tools','tx import + cost-basis/PnL report','per-report / subscription',{m:'every holder needs it'}),
  P('Multi-chain portfolio dashboard','tools','our balance engine, as a public dashboard','freemium / pro tier',{}),
  P('Yield optimizer tool','tools','best organic stable yield by chain/capital','affiliate + pro',{}),
  P('Wallet bundle/health scanner','tools','approvals + risk + dust across chains','freemium',{}),
  P('Gas refund / approval revoker','tools','find + revoke risky token approvals','tips / freemium',{}),
  P('Cross-chain bridge router','tools','cheapest/safest bridge route finder','affiliate fees',{}),
  P('Onchain alert builder (no-code)','tools','let users build their own alerts on our engine','subscription',{}),
  P('Backtest-as-a-service','tools','rent the quant backtest engine','usage-billed',{}),

  // ── trading / edge detection (surface inefficiency → signal or act) ──
  P('Signal/alpha feed (paid)','edge','omnione analytics as a subscription signal','subscription',{m:'$2B+ tg-bot fee market'}),
  P('Copy-trade vault','edge','our edge becomes the product; followers pay a cut','perf fee',{c:'some'}),
  P('Funding-rate harvest signals','edge','keyless funding extremes → carry signals','subscription',{}),
  P('Cointegration pairs scanner','edge','stat-arb pair candidates','desk subscription',{}),
  P('New-listing sniper signals','edge','detect new pools/listings first','subscription (operator executes)',{}),
  P('Liquidation-hunt signals','edge','positions to liquidate (bot bounty)','keeper bounty',{c:'gas'}),
  P('MEV-aware order timing','edge','sandwich-resistant execution timing (defensive)','tool / fee',{}),
  P('Prediction-market edge','edge','our pulse vs market odds mispricing','subscription',{c:'capital to bet'}),
  P('Cross-exchange rebate farming','edge','maker rebate optimizer','rev-share',{}),
  P('Regime-router signals','edge','grid⇄trend⇄chop regime calls','subscription',{}),

  // ── infrastructure (run things others pay for) ──
  P('Run a public RPC/indexer','infra','mesh hosts an RPC/subgraph others query','usage fees + grants',{c:'small'}),
  P('Oracle/keeper node','infra','run upkeep/keeper jobs','gas+fee per call',{c:'gas'}),
  P('Validator/PoS operation','infra','operate validators (legal on VPS)','commission on stake',{c:'capital/deleg'}),
  P('DePIN node fleet','infra','bandwidth/compute DePIN across the mesh','passive + airdrop',{e:'low'}),
  P('Data-availability/relayer node','infra','run DA/relayer infra for incentives','rewards',{}),
  P('Self-host bot hosting','infra','host trading/alert bots for others','hosting fee',{}),
  P('Snapshot/archive service','infra','historical onchain data hosting','subscription',{}),
  P('Testnet node-as-a-service','infra','run testnet nodes for airdrop-farmers','per-node fee + own airdrops',{}),
  P('Webhook/event infra','infra','onchain-event → webhook delivery','usage-billed',{}),
  P('IPFS/Arweave pinning','infra','pin content for projects','storage fee',{}),

  // ── content / research / influence ──
  P('Paid research newsletter','content','our daily brief + deep dives','subscriptions',{m:'$1k+/mo achievable'}),
  P('Protocol deep-dive reports','content','AI-written, data-grounded reports','per-report sales',{}),
  P('Ambassador / KOL technical','content','protocols pay for credible technical content','retainer + tokens',{}),
  P('InfoFi / Cookie.fun content','content','quality CT analysis rewards','points → tokens',{e:'low'}),
  P('YouTube/short-form automation','content','faceless AI crypto-analysis channel','ad rev + sponsors',{}),
  P('Course / cohort','content','teach airdrop/security/quant skills','course sales',{}),
  P('Paid alpha community','content','gated group on real signal','membership',{}),
  P('Sponsored dashboards','content','branded versions of our tools','sponsorship',{}),
  P('Affiliate/referral engine','content','refer the exchanges/tools we use','rev-share',{e:'low'}),
  P('Zora content coins','content','coin our analysis posts','1%/trade + upside',{c:'gas'}),

  // ── fintech / adjacent (broader money tooling) ──
  P('Crypto accounting/bookkeeping','fintech','tx categorization + P&L for small funds','subscription',{}),
  P('Invoicing/payments in stables','fintech','stablecoin invoicing tool for freelancers','fee per invoice',{}),
  P('Treasury dashboard (DAOs/SMBs)','fintech','multi-chain treasury monitor + reports','B2B subscription',{}),
  P('Payroll in crypto','fintech','recurring stablecoin payroll tooling','per-seat',{}),
  P('Expense/receipt → onchain','fintech','crypto expense tracking','subscription',{}),
  P('FX/stablecoin arb for remittance','fintech','cheapest cross-border stable route','fee',{c:'capital'}),
  P('Subscription-billing in crypto','fintech','recurring onchain billing infra','% of volume',{}),
  P('Card-spend optimizer','fintech','best crypto card/cashback router','affiliate',{}),
  P('Savings/yield front-end','fintech','simple UX over organic yield (we rank it)','spread / affiliate',{}),
  P('Compliance/tax-lot reporter','fintech','jurisdiction-aware tax-lot reports','per-report',{}),

  // ── automation / agents (bots that do work for a fee) ──
  P('Telegram trading bot (fee share)','agent','Banana/Trojan-style UX, keep % of routed volume','% of volume',{m:'$2.29B/yr fees'}),
  P('Auto-claim assistant (guarded)','agent','prep + verify airdrop claims (user signs)','tip / subscription',{}),
  P('Auto-compounder','agent','route idle stables to best organic yield','% or flat (user funds)',{c:'capital'}),
  P('Quest/airdrop task agent','agent','complete quests with user oversight','per-task',{}),
  P('AI freelancer agent','agent','solve Algora/Gitcoin bounty issues','per-bounty',{e:'high'}),
  P('Grant-application agent','agent','draft + queue grant apps at volume','% of grants won',{}),
  P('Social-listening signal bot','agent','sentiment → trade/alert feed','subscription',{}),
  P('Sniping/new-pool agent','agent','first-mover detection (user approves)','% of gains',{c:'capital'}),
  P('Liquidation keeper bot','agent','run liquidations for the bounty','keeper bounty',{c:'gas'}),
  P('Cross-chain rebalancer','agent','bounded auto-rebalance (allowlist)','% (user funds)',{c:'capital'}),

  // ── niche / iykyk / services ──
  P('Grant-writing as a service','niche','we know the grant game → write for others','% of grants',{e:'low'}),
  P('Airdrop-farming consulting','niche','sell the playbook + tooling','consulting + product',{}),
  P('Bug-bounty triage for projects','niche','help projects run their bounty program','retainer',{}),
  P('Tokenomics/sim modeling','niche','our MC/quant for token launches','per-engagement',{}),
  P('Liquidity-bootstrapping service','niche','LBP/launch support','service fee',{c:'some'}),
  P('Onchain reputation/attestation','niche','EAS-based identity/credential tools','B2B',{}),
  P('Sybil-detection for protocols','niche','help airdrops filter sybils (we know the patterns)','retainer',{e:'high'}),
  P('Market-making for new tokens','niche','provide quotes/liquidity','rebates/spread',{c:'capital'}),
  P('Prediction-market creation','niche','author + seed markets','creator fee',{c:'some'}),
  P('Open-source maintainer funding','niche','tea.xyz/Sponsors/grants for our repos','passive',{e:'low'}),
];

const seen=new Set(); const out=[];
for(const p of T){ if(seen.has(p.name)) continue; seen.add(p.name); out.push(p); if(out.length>=100) break; }
mkdirSync(path.join(LAB,'config'),{recursive:true});
const doc={ _doc:'100 ways to make money by LEVERAGING OUR SYSTEM (dashboard · keyless scanners · multi-chain wallet · mesh · quant/backtest engines · AI). Operator-requested: bug-bounty/skill + data + monitoring + tools + niche, across crypto/blockchain/wallet/dashboard/fintech + adjacent. Each: what our system does → how it pays. Ranked by buildable × ours × low-capital in /api/system-plays.', count:out.length, plays:out };
writeFileSync(path.join(LAB,'config','system-plays.json'), JSON.stringify(doc,null,1));
const byCat={}; for(const p of out){ byCat[p.cat]=(byCat[p.cat]||0)+1; }
console.log('wrote', out.length, 'system plays ·', JSON.stringify(byCat));
