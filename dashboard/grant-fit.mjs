// grant-fit.mjs — creative-sweep #4: reverse-index grant programs against what we ALREADY shipped, then
// auto-draft the top matches. Uses the free-model fleet (litellm on the OVH mesh node, keyless on tailnet)
// to score fit + draft tailored applications. The rare grant qualifier — a shipped, running, open-source
// agent with a public commit history — already exists; most applicants lack it. On-demand (not per-tick).
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = path.join(LAB, 'data', 'grant-applications');
const LATEST = path.join(LAB, 'data', 'grantfit-latest.json');
const QUEUE = path.join(LAB, 'data', 'action-queue.jsonl');
const LLM_URL = process.env.MESH_LLM_URL || 'http://TAILNET_IP:4000/v1/chat/completions';
const LLM_MODEL = process.env.MESH_LLM_MODEL || 'sstiem-big-free';

// Our honest, verifiable shipped-artifact inventory = the grant pitch.
const PROFILE = `PROJECT: mesh (github.com/sstiempro/mesh) — an autonomous, open-source, KEYLESS crypto-intelligence + security engine.
SHIPPED & RUNNING (verifiable, public commit history, 70+ commits):
- 79 live keyless monitors on a 24/7 cron: stablecoin depeg, protocol TVL-drain EXPLOIT early-warning, DeFi hack ledger, cross-venue funding arbitrage, yield radar, token-unlock (sell-pressure) calendar, Snapshot governance watch, Deribit DVOL vol-regime, Polymarket prediction-market odds + whale flow, narrative rotation, macro risk-on/off regime clock.
- A smart-contract AUDIT pipeline (Slither + Aderyn + Foundry + multi-agent review) for public-goods security.
- An open-core public signal FEED (RSS/JSON) + forge-proof ed25519 licensing — free tier for the commons, pro tier sustains it.
- An autonomous build engine: discover opportunities -> crunch into work -> ship, no human in the loop.
- 100% keyless / free public data sources (DefiLlama, Hyperliquid, CoinGecko, Snapshot, Deribit, public RPCs) — no proprietary data moats, fully reproducible.
STRENGTHS FOR GRANTS: open-source, public good (free exploit early-warning + security tooling protect users), already-built & running (not a proposal), reproducible, solo independent builder, aligned with public-goods / developer-tooling / security / data-availability funding theses.`;

const CURATED = [
  { name: 'Gitcoin Grants', focus: 'open-source public goods, quadratic funding rounds', url: 'https://grants.gitcoin.co' },
  { name: 'Optimism Retro Funding', focus: 'retroactive public goods funding (impact already delivered)', url: 'https://app.optimism.io/retropgf' },
  { name: 'Octant', focus: 'public goods epochs (Golem/Ethereum), recurring', url: 'https://octant.app' },
  { name: 'Drips Network', focus: 'continuous funding for open-source dependencies', url: 'https://drips.network' },
  { name: 'Ethereum Foundation ESP', focus: 'ecosystem support: tooling, research, infrastructure', url: 'https://esp.ethereum.foundation' },
  { name: 'Arbitrum Foundation Grants', focus: 'ecosystem tooling, dev infra, public goods on Arbitrum', url: 'https://arbitrum.foundation/grants' },
  { name: 'Base Ecosystem / Builder Grants', focus: 'builders shipping on Base, onchain tooling', url: 'https://base.org/grants' },
  { name: 'Web3 Foundation Grants', focus: 'technical/open-source: tooling, infra, research', url: 'https://grants.web3.foundation' },
  { name: 'Polygon Community Grants', focus: 'ecosystem dev tooling + public goods', url: 'https://polygon.technology/grants' },
  { name: 'Uniswap Foundation Grants', focus: 'DeFi research, analytics, security, tooling', url: 'https://www.unigrants.org' },
  { name: 'DoraHacks BUIDL', focus: 'continuous open builder grants across ecosystems', url: 'https://dorahacks.io' },
  { name: 'Solana Foundation Grants', focus: 'tooling, infra, public goods on Solana', url: 'https://solana.org/grants' },
];

async function llm(prompt, { system, maxTokens = 1400, temperature = 0.4 } = {}) {
  try {
    const r = await fetch(LLM_URL, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-mesh' },
      body: JSON.stringify({ model: LLM_MODEL, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const body = (m[1] || text).trim();
  const start = body.search(/[[{]/); if (start < 0) return null;
  try { return JSON.parse(body.slice(start)); } catch {}
  // try to find the largest balanced array
  try { const a = body.indexOf('['), b = body.lastIndexOf(']'); if (a >= 0 && b > a) return JSON.parse(body.slice(a, b + 1)); } catch {}
  return null;
}

async function loadPrograms() {
  const progs = [...CURATED];
  // breadth from Karma GAP (keyless)
  try {
    const r = await runMonitor({ template: 'grants-watch', id: 'gf-grants', params: {} });
    for (const a of (r.alerts || [])) if (a.name && !progs.some(p => p.name.toLowerCase() === a.name.toLowerCase())) progs.push({ name: a.name, focus: 'grant program (Karma GAP indexed)', url: a.url });
  } catch {}
  return progs;
}

async function scoreFit(programs) {
  const list = programs.map((p, i) => `${i}. ${p.name} — ${p.focus}`).join('\n');
  const prompt = `Here is our project profile:\n${PROFILE}\n\nHere are grant programs:\n${list}\n\nScore each program 0-100 for how well OUR specific project fits its funding thesis (favor public-goods / open-source / security / dev-tooling / data programs where an already-shipped running open-source agent is a strong fit). Return ONLY a JSON array of {"i":<index>,"fit":<0-100>,"reason":"<one line>"}. No prose.`;
  const out = await llm(prompt, { temperature: 0.2, maxTokens: 1800 });
  const parsed = extractJson(out);
  if (!Array.isArray(parsed)) return programs.map((p) => ({ ...p, fit: 50, reason: 'LLM scoring unavailable — heuristic default' }));
  const byI = new Map(parsed.map(x => [x.i, x]));
  return programs.map((p, i) => ({ ...p, fit: byI.get(i)?.fit ?? 40, reason: byI.get(i)?.reason || '' })).sort((a, b) => b.fit - a.fit);
}

async function draftApplication(p) {
  const prompt = `Draft a concise, honest grant application for THIS program:\nProgram: ${p.name} — ${p.focus} (${p.url})\n\nApplicant profile:\n${PROFILE}\n\nWrite a ready-to-submit draft in markdown with sections: Title, One-liner, Problem, What we built (cite the concrete shipped artifacts honestly — do NOT invent metrics or users we don't have), Why it fits ${p.name}, Public-good impact, Roadmap (next 3 concrete deliverables), Ask (a reasonable amount + what it funds), Links (github.com/sstiempro/mesh). Be specific and modest; no hype, no fabricated traction. ~400-550 words.`;
  return await llm(prompt, { temperature: 0.5, maxTokens: 1600 });
}

export async function runGrantFit({ n = 5, draft = true } = {}) {
  if (!existsSync(APPS)) await mkdir(APPS, { recursive: true });
  const programs = await loadPrograms();
  const scored = await scoreFit(programs);
  const top = scored.slice(0, n);
  const drafted = [];
  if (draft) {
    for (const p of top) {
      const md = await draftApplication(p);
      if (!md) { drafted.push({ name: p.name, fit: p.fit, draft: null, note: 'LLM draft unavailable' }); continue; }
      const fp = path.join(APPS, slug(p.name) + '.md');
      try { await writeFile(fp, `<!-- fit ${p.fit} · ${p.reason} · ${p.url} -->\n\n` + md); } catch {}
      drafted.push({ name: p.name, fit: p.fit, url: p.url, draft: `data/grant-applications/${slug(p.name)}.md` });
    }
  }
  // queue approve-cards for the drafted top matches (dedupe by sig against pending)
  let queued = 0;
  try {
    const existing = existsSync(QUEUE) ? readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
    const pending = new Set(existing.filter(e => e.status && e.status !== 'done' && e.status !== 'dismissed').map(e => e.sig));
    for (const d of drafted.filter(d => d.draft)) {
      const sig = `grant-apply:${slug(d.name)}`;
      if (pending.has(sig)) continue; pending.add(sig);
      await appendFile(QUEUE, JSON.stringify({ lane: 'approve', type: 'grant-apply', asset: d.name, action: `Apply to ${d.name} (fit ${d.fit}) — draft ready: ${d.draft}`, needs: 'identity + submit click', why: 'funding for builds', url: d.url, sig, status: 'pending', queued: new Date().toISOString() }) + '\n');
      queued++;
    }
  } catch {}
  const result = { ts: Date.now(), programs_scored: scored.length, llm: LLM_MODEL, drafted: drafted.length, queued, top: scored.slice(0, 12).map(p => ({ name: p.name, fit: p.fit, reason: p.reason, url: p.url })), drafts: drafted };
  try { await writeFile(LATEST, JSON.stringify(result, null, 2)); } catch {}
  return result;
}

export async function grantFitView() {
  try { return JSON.parse(await readFile(LATEST, 'utf8')); } catch { return { note: 'no GrantFit run yet — POST /api/grantfit/run or call runGrantFit()', top: [], drafts: [] }; }
}

// cron entry point: re-run only when stale, so grant programs discovered by grants-watch actually get
// drafted over time without a human remembering to POST /api/grantfit/run (that was the gap — it only
// ever ran once, manually, then every newly-discovered program sat as an undrafted card forever).
export async function runGrantFitIfStale(hours = 6) {
  let age = Infinity;
  try { age = Date.now() - JSON.parse(await readFile(LATEST, 'utf8')).ts; } catch {}
  if (age < hours * 3600e3) return { skipped: true, age_h: +(age / 3600e3).toFixed(1) };
  return await runGrantFit({ n: 5 });
}
