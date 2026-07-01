#!/usr/bin/env node
// idea-gen.mjs — the "new ideas every 5 min" engine. Combinatorially invents NEW build specs from
// the avenue corpus + monitor template grid, scores them, dedupes against the queue+ledger, and
// appends the novel ones to data/build-queue.jsonl. Two kinds:
//   kind:'auto'  → a new monitor = template × novel params → the builder INSTANTIATES it (real, runs now)
//   kind:'spec'  → a buildable avenue crossed into a concrete idea → queued for a build pass
// Standalone: `node tools/idea-gen.mjs`  ·  or import generate() from the builder tick.
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = path.join(LAB, 'data', 'build-queue.jsonl');
const LEDGER = path.join(LAB, 'data', 'build-ledger.jsonl');
const CATS_CACHE = path.join(LAB, 'data', 'llama-categories-cache.json');
const J = (f) => { try { return JSON.parse(readFileSync(path.join(LAB, 'config', f), 'utf8')); } catch { return null; } };

// ── auto-buildable monitor grid: every combo is a REAL distinct monitor ──
// Fallback CATS (used only if the live DeFiLlama fetch fails and no disk cache exists) — kept as a
// floor so idea generation never fully dies on a network blip.
const CATS_FALLBACK = ['Bridge', 'Lending', 'Dexes', 'CDP', 'Liquid Staking', 'Yield', 'Derivatives', 'RWA', 'Restaking', 'Liquid Restaking', 'Farm'];
const CHAINS = { base: 'https://mainnet.base.org', arbitrum: 'https://arb1.arbitrum.io/rpc', optimism: 'https://mainnet.optimism.io', polygon: 'https://polygon-rpc.com' };
const STABLE_SETS = {
  'algo-stables': 'frax,usdd,gho,crvusd,liquity-usd',
  'rwa-stables': 'usual-usd,ondo-us-dollar-yield,mountain-protocol-usdm',
  'majors-tight': 'tether,usd-coin,dai',
};
const CATS_TTL_MS = 6 * 60 * 60 * 1000; // refetch live categories at most every 6h

// Genuinely open-ended: pull the LIVE, currently-active category list straight off DeFiLlama's
// /protocols endpoint (keyless) instead of a hardcoded array, so the grid grows as the real world
// does (new categories, new sectors) rather than converging on a fixed enumeration forever.
// Cached to disk with a TTL (don't hammer the API every 5-min cron tick) and falls back to the
// on-disk cache, then the hardcoded CATS_FALLBACK, if the live fetch is down — never throws.
async function liveCategories() {
  let cached = null;
  try { cached = JSON.parse(readFileSync(CATS_CACHE, 'utf8')); } catch {}
  if (cached?.cats?.length && Date.now() - (cached.ts || 0) < CATS_TTL_MS) return cached.cats;
  try {
    const r = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'mesh-monitor' } });
    const j = await r.json();
    if (Array.isArray(j) && j.length) {
      const cats = [...new Set(j.map(p => p.category).filter(Boolean))].sort();
      if (cats.length) {
        try { await writeFile(CATS_CACHE, JSON.stringify({ ts: Date.now(), cats })); } catch {}
        return cats;
      }
    }
  } catch {}
  // live fetch failed (or returned nothing usable) — fall back to a stale disk cache, else the hardcoded floor
  return cached?.cats?.length ? cached.cats : CATS_FALLBACK;
}

async function autoGrid() {
  const out = [];
  const CATS = await liveCategories();
  for (const c of CATS) for (const d of [0.1, 0.15, 0.2, 0.25])
    out.push({ template: 'tvl-drain', params: { category: c, minTvl: 2e7, dropPct: d }, label: `${c} TVL-drain ${Math.round(d * 100)}%`, monetize: 'exploit/exit early-warning feed (security teams)' });
  for (const t of [0.0005, 0.0008, 0.0012, 0.002])
    out.push({ template: 'funding-extreme', params: { threshold: t }, label: `Funding extremes ≥${(t * 100).toFixed(2)}%`, monetize: 'crowded-positioning signal → mean-revert' });
  for (const [name, ids] of Object.entries(STABLE_SETS)) for (const thr of [0.003, 0.005, 0.01])
    out.push({ template: 'stable-depeg', params: { ids, threshold: thr }, label: `Depeg watch: ${name} @${thr * 100}%`, monetize: 'depeg-alert + arb trigger' });
  for (const [name, apy, stable] of [['safe', 8, true], ['degen', 50, false], ['stable-mid', 20, true]])
    out.push({ template: 'yield-spike', params: { minApy: apy, stableOnly: stable, minTvl: stable ? 5e6 : 5e5 }, label: `Yield radar: ${name} ≥${apy}%`, monetize: 'yield-radar feed / API' });
  for (const [chain, rpc] of Object.entries(CHAINS))
    out.push({ template: 'gas-watch', params: { rpc, chain, threshold: chain === 'polygon' ? 100 : 5 }, label: `${chain} gas watch`, monetize: 'L2 tx-timing + bridge-window alert' });
  return out;
}

// ── spec ideas: cross a buildable avenue with a build twist (needs a build pass) ──
const TWISTS = [
  'package as a paid webhook feed (open-core: free digest, pro realtime)',
  'wire the signal into the omnione paper-sim as an entry gate',
  'cross-reference two monitors for a confluence alert',
  'expose as a public read-only API endpoint + rate-limit',
  'turn the output into a daily auto-posted thread (attention → audience)',
  'backtest the signal against stored candle history for an edge stat',
];
function specIdeas(rng, n) {
  const sp = J('system-plays.json')?.plays?.filter(p => p.buildable === 'yes' && p.capital === 0) || [];
  const em = J('edge-mechanisms.json')?.mechanisms?.filter(m => m.build === 'partial' || m.build === 'full') || [];
  const pool = [...sp.map(p => ({ from: `system:${p.id}`, name: p.name })), ...em.map(m => ({ from: `edge:${m.id}`, name: m.name }))];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const base = pool[Math.floor(rng() * pool.length)];
    const twist = TWISTS[Math.floor(rng() * TWISTS.length)];
    out.push({ kind: 'spec', from: base.from, idea: `${base.name} → ${twist}`, status: 'queued' });
  }
  return out;
}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sig = (o) => o.kind === 'auto' ? `auto:${o.template}:${JSON.stringify(o.params)}` : `spec:${o.idea}`;

function seenSet() {
  const s = new Set();
  for (const f of [QUEUE, LEDGER]) if (existsSync(f)) for (const ln of readFileSync(f, 'utf8').split('\n')) {
    if (!ln.trim()) continue; try { const o = JSON.parse(ln); if (o.sig) s.add(o.sig); } catch {}
  }
  return s;
}

// score: buildable-now (auto) + low-capital + ai-leverage bias
function score(o) {
  if (o.kind === 'auto') return 70 + Math.round(Math.random() * 20); // already runnable = high
  return 35 + Math.round(Math.random() * 35);
}

export async function generate({ autoN = 3, specN = 2 } = {}) {
  const seen = seenSet();
  const rng = mulberry32((Date.now() / 1000 | 0) ^ 0x9e3779b9);
  const grid = (await autoGrid()).sort(() => rng() - 0.5);
  const out = [];
  for (const g of grid) { if (out.filter(x => x.kind === 'auto').length >= autoN) break; const o = { kind: 'auto', ...g }; o.sig = sig(o); if (!seen.has(o.sig)) { out.push(o); seen.add(o.sig); } }
  for (const s of specIdeas(rng, specN * 3)) { if (out.filter(x => x.kind === 'spec').length >= specN) break; s.sig = sig(s); if (!seen.has(s.sig)) { out.push(s); seen.add(s.sig); } }
  const now = new Date().toISOString();
  for (const o of out) { o.id = `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; o.score = score(o); o.ts = now; o.status = o.status || 'queued'; await appendFile(QUEUE, JSON.stringify(o) + '\n'); }
  return out;
}

// standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  generate().then(out => { console.log(`+${out.length} new ideas →`, out.map(o => o.kind === 'auto' ? `[auto] ${o.label}` : `[spec] ${o.idea.slice(0, 60)}`)); });
}
