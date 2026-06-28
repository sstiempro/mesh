#!/usr/bin/env node
// Generate config/fringe-100.json — 100 zero-capital fringe/creation/iykyk income concepts,
// each with TESTABLE parameters so the Monte-Carlo stack harness can simulate combinations.
// Params (honest, rough — the MC surfaces distributions, not promises):
//   ts=setup hours (one-time) · tw=ongoing hrs/week · p=monthly prob of ANY payout
//   lo/hi=monthly $ when it pays · tp/ta=rare fat-tail prob / amount (viral coin, big airdrop, crit bug)
//   mesh=uses the mesh · ai=AI does the heavy lifting · id=parallel instances (devices/identities, sybil-independent)
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// HONEST priors (recalibrated down): most fringe plays pay $0 most months; the EV lives in the rare
// tail (viral coin / big airdrop / crit bug). p = monthly prob of ANY payout. These are rough upper-ish
// guesses — the MC's value is the SHAPE + the relative ranking (what dominates), not the literal dollars.
const DEF = {
  'creator-coins':   {ts:1,  tw:2,  p:0.20, lo:0,  hi:30,  tp:0.012,ta:1000,  mesh:false, ai:true,  id:1},
  'ai-content':      {ts:15, tw:3,  p:0.25, lo:0,  hi:200, tp:0.015,ta:1800,  mesh:false, ai:true,  id:1},
  'digital-product': {ts:25, tw:2,  p:0.22, lo:0,  hi:300, tp:0.018,ta:4000,  mesh:false, ai:true,  id:1},
  'onchain-create':  {ts:8,  tw:1,  p:0.18, lo:0,  hi:120, tp:0.022,ta:3500,  mesh:false, ai:true,  id:1},
  'knowledge-arb':   {ts:12, tw:3,  p:0.25, lo:0,  hi:400, tp:0.015,ta:2500,  mesh:false, ai:true,  id:1},
  'attention':       {ts:3,  tw:2,  p:0.25, lo:0,  hi:70,  tp:0.015,ta:1200,  mesh:false, ai:true,  id:1},
  'compute-mesh':    {ts:1,  tw:0.2,p:0.85, lo:1,  hi:9,   tp:0.004,ta:200,   mesh:true,  ai:false, id:3},
  'airdrop-points':  {ts:2,  tw:0.5,p:0.10, lo:0,  hi:50,  tp:0.025,ta:2500,  mesh:false, ai:true,  id:2},
  'automation':      {ts:20, tw:1,  p:0.25, lo:0,  hi:300, tp:0.02, ta:4500,  mesh:true,  ai:true,  id:1},
  'security-skill':  {ts:80, tw:8,  p:0.18, lo:0,  hi:1200,tp:0.03, ta:22000, mesh:false, ai:true,  id:1},
  'market-liq':      {ts:6,  tw:1,  p:0.30, lo:0,  hi:120, tp:0.015,ta:2200,  mesh:false, ai:true,  id:1},
  'gaming':          {ts:1,  tw:1.5,p:0.18, lo:0,  hi:25,  tp:0.015,ta:600,   mesh:false, ai:false, id:2},
  'data-product':    {ts:20, tw:2,  p:0.22, lo:0,  hi:500, tp:0.015,ta:5000,  mesh:false, ai:true,  id:1},
  'foundation':      {ts:2,  tw:0.2,p:0.0,  lo:0,  hi:0,   tp:0,    ta:0,     mesh:false, ai:true,  id:1},
};
let N=0;
const C=(name,cat,note,ov={})=>({ id:'f'+(++N), name, cat, ...DEF[cat], ...ov, note });

const T=[
  // ── creator-coins (Zora-style: create content → earn 1% on every trade) ──
  C('Zora content coins','creator-coins','Every post is a coin; you earn 1% of all trades on it. Post consistently; AI helps ideate/produce.'),
  C('Zora creator coin ($you)','creator-coins','Profile-level coin = your ticker; earns from all your content activity. Build an audience.',{hi:120,ta:4000}),
  C('Zora attention markets','creator-coins','Create tradable markets around trends/memes/hashtags; first-mover on a narrative earns.',{p:0.4,ta:3000}),
  C('Farcaster/Base mini-coin drops','creator-coins','Coin a viral cast/frame; community trades it. Pairs with the Farcaster identity.'),
  C('Meme-as-asset (your IP)','creator-coins','Create an original meme/character, coin it, build lore. Creation, not a copy.',{ta:5000}),
  C('Music coin (AI-assisted)','creator-coins','Coin AI-assisted tracks; fans trade. Ties to streaming royalties too.',{ts:6}),
  C('Art-drop coins','creator-coins','Coin generative/AI art series with a release schedule; collectors trade.',{ts:4}),
  C('Newsletter-to-coin','creator-coins','Tokenize a content series; readers hold/trade access + upside.',{ts:6,hi:150}),

  // ── ai-content (faceless, AI-produced, free-to-host platforms) ──
  C('Faceless YouTube automation','ai-content','AI scripts+voiceover+stock → ad revenue. Real example: ~$4.2k/mo at 3h/wk after sandbox.',{hi:600,ta:8000}),
  C('Amazon KDP ebooks','ai-content','AI-drafted niche non-fiction/low-content books; free upload, royalties forever.',{ts:20,hi:500,ta:6000}),
  C('Print-on-demand (Redbubble/Merch)','ai-content','AI designs on free POD; passive per-sale royalty, no inventory.',{ts:10,hi:300}),
  C('AI music royalties (Suno→DSPs)','ai-content','Generate tracks, distribute to Spotify/Apple; per-stream royalties + sync licensing.',{hi:300,ta:4000}),
  C('Faceless short-form (TikTok/Reels/Shorts)','ai-content','AI-edited shorts at volume; creator funds + affiliate + brand deals.',{tw:4,hi:500,ta:6000,id:2}),
  C('Stock media library','ai-content','AI/photo stock to Adobe/Shutterstock; royalty per download, compounds with catalog size.',{ts:20,hi:250}),
  C('Content repurposing engine','ai-content','One asset → tweets/Reddit/Pinterest/LinkedIn auto-distributed; multiplies any other content play.',{ts:8,p:0.5}),
  C('AI narration / audiobook','ai-content','Turn public-domain or your text into audiobooks; ACX/streaming royalties.',{ts:15,hi:200}),
  C('Niche blog + programmatic SEO','ai-content','AI-generated programmatic pages at scale; display ads + affiliate after sandbox.',{ts:30,hi:700,ta:5000}),
  C('AI-generated coloring/activity books','ai-content','Ultra-low-content KDP niche; tiny effort per title, stack many titles.',{ts:6,hi:150,id:3}),

  // ── digital-product (build once, sell forever) ──
  C('Micro-SaaS / tiny tool','digital-product','AI-built single-purpose web tool on a subscription; one good one compounds.',{hi:1200,ta:15000}),
  C('Chrome / browser extension','digital-product','Solve one annoyance; freemium or one-time. Free to publish.',{ts:20,hi:500}),
  C('Custom GPT / agent in a marketplace','digital-product','Publish a specialized GPT/agent; marketplace rev-share or lead-gen.',{ts:8,hi:300}),
  C('Notion / template products','digital-product','Sell templates (Notion/Sheets/Figma) on Gumroad; pure margin.',{ts:10,hi:400,id:2}),
  C('API wrapper / data API','digital-product','Wrap a free data source into a paid API (RapidAPI); usage-billed.',{hi:600,ta:6000}),
  C('Datasets for AI training','digital-product','Curate/generate niche datasets; sell on HuggingFace/Kaggle/marketplaces.',{hi:500}),
  C('Boilerplate / starter kit','digital-product','Sell a dev boilerplate (the dashboard could be one); one-time per buyer.',{ts:15,hi:500}),
  C('Telegram/Discord bot SaaS','digital-product','Community bot with a paid tier; recurring per server.',{mesh:true,hi:500}),
  C('Prompt packs / AI workflows','digital-product','Package proven prompts/workflows; low-ticket high-volume.',{ts:6,hi:200,id:2}),
  C('Figma/design asset packs','digital-product','UI kits, icon sets; marketplaces pay royalties.',{ts:12,hi:300}),

  // ── onchain-create (deploy things others use → fees / grants / airdrops) ──
  C('Deploy a fee-earning contract','onchain-create','Ship a useful contract (router/util) that takes a tiny fee on use.',{ta:8000}),
  C('Farcaster Frame / miniapp','onchain-create','Build a viral Frame; distribution is built-in, earns via tips/coins/sponsor.',{ts:5}),
  C('NFT collection with real utility','onchain-create','Mint a collection that DOES something (access/tool); primary + royalty.',{ta:10000}),
  C('Create a prediction market','onchain-create','Spin up markets (Polymarket-style) on real questions; creator fee on volume.',{ts:5,p:0.4}),
  C('Onchain mini-game','onchain-create','Deploy a simple onchain game; fees + token + airdrop eligibility.',{ts:15,ta:6000}),
  C('Tokenize a real utility','onchain-create','Create a token that gates a real product/service you run. Substance-first.',{ta:8000}),
  C('Indexer/subgraph as a service','onchain-create','Host a subgraph others query; usage fees + ecosystem grants.',{mesh:true,hi:400}),
  C('Onchain attestation/identity tool','onchain-create','Build an EAS-based attestation tool; grant-friendly + fee potential.',{ts:10}),
  C('Liquidity-pool / vault product','onchain-create','Create a strategy vault; performance/mgmt fee (omnione edge as the product).',{ts:20,ta:9000}),
  C('Launch an AI agent (Virtuals/Base)','onchain-create','Tokenize a REAL-substance agent (omnione analytics); fees + co-owned revenue. Needs $VIRTUAL.',{ts:15,ta:20000}),

  // ── knowledge-arb (know something → sell the knowing) ──
  C('Paid newsletter','knowledge-arb','Niche edge (quant/DePIN/airdrops) → subscriptions; AI drafts, you curate.',{hi:1500,ta:8000}),
  C('Cohort/online course','knowledge-arb','Package what you know into a course; evergreen sales.',{ts:25,hi:2000,ta:12000}),
  C('Paid community / alpha group','knowledge-arb','Gated Discord/Telegram with real signal; recurring membership.',{hi:1200,ta:8000}),
  C('Grant-writing as a service','knowledge-arb','You now know the grant game → write grants for other builders for a cut.',{hi:1500}),
  C('Airdrop/farming guide product','knowledge-arb','Sell the playbook/tooling you built; info product + affiliate.',{ts:8,hi:400}),
  C('Consulting / fractional','knowledge-arb','Quant/AI/infra advisory; high $/hr, zero capital.',{ts:2,tw:5,hi:3000}),
  C('Sell research reports','knowledge-arb','Deep-dive reports (protocols/edges); one-to-many sales.',{hi:600}),
  C('Bounty/grant intel service','knowledge-arb','Aggregate + alert on live grants/bounties (you have the registry) as a paid feed.',{ts:6,hi:400}),

  // ── attention (social distribution → money) ──
  C('Farcaster account (PoH foundation)','attention','Neynar proof-of-humanity that boosts sybil-resistance across ALL farming + its own rewards.',{cat:'attention',p:0.3}),
  C('Affiliate / referral cascades','attention','Refer exchanges/tools you use; recurring rev-share, compounds with audience.',{hi:300,ta:3000,id:2}),
  C('X creator monetization','attention','Ads rev-share + tips (note: post-to-earn bots banned; real content only).',{hi:400,ta:5000}),
  C('Threads-to-product funnel','attention','Build attention → funnel to your products/coins. Multiplies everything else.',{p:0.5}),
  C('Ambassador / KOL programs','attention','Protocols pay for genuine technical content/advocacy; AI drafts, you ship.',{hi:500}),
  C('Bounty-board content','attention','Write/create for protocol content bounties (Layer3, etc.); per-piece pay.',{hi:300,id:2}),
  C('Tip-driven open content','attention','Publish genuinely useful threads/repos; tips + sponsorship inbound.',{hi:200}),
  C('Curate-to-earn / InfoFi (Cookie.fun)','attention','Surviving attention-economy reward for quality CT analysis.',{p:0.35,hi:150}),

  // ── compute-mesh (idle hardware → money) ──
  C('Bandwidth DePIN stack','compute-mesh','Honeygain/EarnApp/Pawns across every node; pennies but free + stacks on mining.',{id:3}),
  C('Airdrop DePIN nodes','compute-mesh','Grass/Nodepay/Gradient = early-node token call-options on idle bandwidth.',{p:0.3,hi:5,ta:3000,id:3}),
  C('CPU mining (idle compute)','compute-mesh','Already live; XMR on idle cores, governor-protected.',{p:0.95,id:3}),
  C('Idle GPU/compute rental','compute-mesh','Rent idle compute (io.net/Akash/Nosana/Salad) where ARM is supported.',{p:0.6,hi:30}),
  C('Decentralized storage','compute-mesh','Share disk on Filecoin/Storj/Crust; passive per-GB.',{hi:15}),
  C('Run a public RPC / relay','compute-mesh','Operate an RPC/relay/light-node; some pay or airdrop operators.',{p:0.4,hi:40,ta:2000}),
  C('Oracle / keeper node','compute-mesh','Run a keeper/oracle that earns gas+fee for upkeep calls.',{ts:10,p:0.5,hi:80}),
  C('Bandwidth for AI scraping (vetted)','compute-mesh','Sell residential bandwidth to vetted networks; same as DePIN, more $/GB on residential.',{id:2}),
  C('Hotspot / wireless DePIN','compute-mesh','Helium-style coverage if you have a device/location; passive.',{ts:3,p:0.5,hi:30}),

  // ── airdrop-points (use protocol → points → token) ──
  C('Testnet node operator','airdrop-points','Run validators/nodes the mesh can (Aleph Zero/Shardeum); merit-scored airdrops.',{mesh:true,ta:5000,id:2}),
  C('Points programs (Eigen/Rainbow)','airdrop-points','Genuinely use protocols → pre-TGE points → token.',{ta:3000}),
  C('Retroactive protocol usage','airdrop-points','Use new protocols early + real → retroactive snapshot rewards.',{ta:4000,id:2}),
  C('Quest sprints (Layer3/Galxe)','airdrop-points','Consistent quest completion; XP → token + per-quest payouts.',{p:0.4,hi:60,id:2}),
  C('Telegram tap-to-earn','gaming','Dropee/X-Empire ~5min/day; airdrop-shaped. Cap time or it is a drain.',{ta:1500,id:2}),
  C('Galxe/Zealy bounty quests','airdrop-points','Task bounties + XP; small but steady, stack identities carefully.',{hi:50,id:2}),
  C('Base ecosystem history','airdrop-points','Build genuine onchain history pre Coinbase-L2 distribution.',{ta:5000}),
  C('Early-protocol LP/usage','airdrop-points','Provide tiny liquidity / use new DEXs for points (small gas only).',{ta:3000}),

  // ── automation (bots/agents that earn) ──
  C('Arbitrage bot (CEX/DEX)','automation','Surface + (operator-executes) spreads; omnione opportunity engine feeds it.',{ta:5000}),
  C('Copy-trade / strategy vault','automation','Your edge becomes the product; followers pay a cut.',{ta:9000}),
  C('Telegram trading bot (fee share)','automation','Banana/Trojan-style bot UX; keep a % of routed volume. Build the legit version.',{hi:800,ta:10000}),
  C('Liquidation / keeper bot','automation','Run liquidation bots on lending protocols; earn the bounty.',{ts:25,ta:6000}),
  C('AI freelancer agent','automation','An agent that completes Algora/Upwork-style tasks; you supervise.',{hi:600}),
  C('Sniper / new-listing bot','automation','Auto-detect new listings/launches; first-mover (operator approves trades).',{ta:6000}),
  C('Yield auto-compounder','automation','Auto-route idle stables to best organic yield (engine already ranks it).',{p:0.6,hi:120}),
  C('Social listening → signal bot','automation','Sell a sentiment/signal feed from mesh+omnione analytics.',{hi:500,ta:5000}),
  C('Grant/bounty auto-applier','automation','Agent drafts + queues grant/bounty applications at volume (you submit).',{p:0.4,hi:300}),

  // ── security-skill (skill → money, zero capital) ──
  C('Audit contests (Code4rena/Sherlock)','security-skill','Find vulns in scope; $5-30k active, single crit $10-50k. AI co-audits.'),
  C('Immunefi bug bounties','security-skill','Live-protocol bugs; $1k-$200k+. Lottery tail, huge.',{ta:50000}),
  C('Web2 bug bounties (HackerOne)','security-skill','Broader surface; steadier small-medium payouts.',{ts:60,ta:15000}),
  C('CTF prize pools','security-skill','Competitive CTFs with cash; builds the audit skill too.',{ts:40,p:0.35,hi:1000,ta:8000}),
  C('Code review bounties','security-skill','Paid review on OSS/protocols; lower bar than full audit.',{ts:30,p:0.4,hi:800}),
  C('Secure-OSS fund (GitHub)','security-skill','Funding for securing critical OSS; pairs with your repos.',{ts:20,p:0.3,hi:1000}),

  // ── market-liq (provide a market service → fees) ──
  C('LP fees (concentrated)','market-liq','Provide tight-range liquidity; earn swap fees (needs some capital later).',{p:0.5,hi:200}),
  C('Market-maker rebates','market-liq','Maker rebates on venues that pay for liquidity/quotes.',{ta:3000}),
  C('Create + seed a prediction market','market-liq','Author markets, earn creator fees on volume.',{ts:5,hi:150}),
  C('Validator commission (PoS)','market-liq','Run/operate a validator; commission on delegated stake (legal on VPS).',{mesh:true,ts:10,hi:300,ta:4000}),
  C('Referral on MM/DEX volume','market-liq','Rev-share on routed/maker volume you bring.',{hi:200,id:2}),
  C('Liquidity bootstrapping for others','market-liq','Provide LBP/launch services for new projects; service fee.',{hi:400}),

  // ── gaming ──
  C('Skill-based crypto games','gaming','Chess/poker/strategy with real stakes; edge = your skill.',{ta:2000}),
  C('Game-asset flipping','gaming','Buy-low/sell-high in-game assets/NFTs you understand.',{p:0.35,hi:150}),
  C('Web3 game testnet/airdrop','gaming','Play early game testnets for token allocations.',{ta:3000,id:2}),
  C('Tournament/ladder prizes','gaming','Competitive ladders with prize pools; skill-gated.',{p:0.3,hi:300}),

  // ── data-product (your mesh + omnione = data others pay for) ──
  C('Sell omnione signals (feed)','data-product','Package the analytics as a paid signal/sentiment feed.',{ta:10000}),
  C('Mesh-health benchmark data','data-product','Anonymized hardware/health benchmarks as a dataset/API.',{hi:300}),
  C('Onchain analytics dashboard (paid)','data-product','Productize a niche dashboard; subscription.',{hi:700,ta:6000}),
  C('Backtest-as-a-service','data-product','Rent the backtest engine for strategies; usage-billed.',{hi:500}),
  C('Custom alpha reports','data-product','Bespoke quant reports from the engine; per-report.',{hi:800}),

  // ── foundations (near-zero cost, UNLOCK/boost many others — the combination multipliers) ──
  C('Build-in-public (public GitHub)','foundation','Unlocks Base Builder Rewards + Gitcoin + OP Retro + tea.xyz + Sponsors off ONE signal.'),
  C('Basename + onchain identity','foundation','Required for Base rewards; boosts Builder Score + every onchain play.'),
  C('Hot farming wallet + Farcaster PoH','foundation','Sybil-resistant identity that multiplies airdrop/points eligibility.'),
  C('Reusable build (one repo, many entries)','foundation','One project entered across many hackathons/grants = leverage.'),
];

// cap the PLAYS at 100, then always append the foundations (they're the combination-multipliers, never truncated)
const seen=new Set(); const plays=[]; const founds=[];
for(const t of T){ if(seen.has(t.name)) continue; seen.add(t.name); if(t.cat==='foundation') founds.push(t); else if(plays.length<100) plays.push(t); }
const out=[...plays, ...founds];
mkdirSync(path.join(LAB,'config'),{recursive:true});
const doc={ _doc:'100 zero-capital fringe/creation/iykyk income concepts with TESTABLE params for the Monte-Carlo stack harness (tools/fringe-mc.mjs). CREATION-positive: we build coins/agents/content/products/markets with real substance and they earn. Params are honest rough priors; the MC turns them into distributions, not promises. cat defaults in tools/gen-fringe.mjs.', count:out.length, concepts:out };
writeFileSync(path.join(LAB,'config','fringe-100.json'), JSON.stringify(doc,null,1));
const byCat={}; for(const t of out){ byCat[t.cat]=(byCat[t.cat]||0)+1; }
console.log('wrote', out.length, 'concepts ·', JSON.stringify(byCat));
