// hackathon-fit.mjs — the real engine behind the card that used to just say "autonomous build engine can
// ship an entry" with nothing backing it (flagged twice by the operator: no such engine existed). This is
// grant-fit.mjs's exact pattern applied to live hackathons instead of grant programs: discover open
// hackathons (hackathon-watch monitor, Devpost, keyless), score fit against what we've ALREADY shipped,
// and auto-draft an honest submission writeup — real artifacts, on disk, ready for the operator's identity
// submit click. It does not fabricate a demo video or claim a custom build for each hackathon; it drafts
// the honest written submission (problem/what-we-built/why-it-fits/tech-stack/links) pointing at the real,
// running, public-commit-history system — which is itself the legitimate entry for tracks that fit.
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = path.join(LAB, 'data', 'hackathon-entries');
const LATEST = path.join(LAB, 'data', 'hackathonfit-latest.json');
const QUEUE = path.join(LAB, 'data', 'action-queue.jsonl');
const LLM_URL = process.env.MESH_LLM_URL || 'http://TAILNET_IP:4000/v1/chat/completions';
const LLM_MODEL = process.env.MESH_LLM_MODEL || 'sstiem-big-free';

// same honest, verifiable shipped-artifact inventory grant-fit.mjs pitches — reused so both engines cite
// the identical real facts, never diverging claims about what exists.
const PROFILE = `PROJECT: mesh (github.com/sstiempro/mesh) — an autonomous, open-source, KEYLESS crypto-intelligence + security engine.
SHIPPED & RUNNING (verifiable, public commit history):
- ~98 live keyless monitors on a 24/7 cron: stablecoin depeg, protocol TVL-drain EXPLOIT early-warning, DeFi hack ledger, cross-venue funding arbitrage, yield radar, token-unlock (sell-pressure) calendar, Snapshot governance watch, Deribit DVOL vol-regime, Polymarket prediction-market odds + whale flow, narrative rotation, macro risk-on/off regime clock.
- monitor-forge.mjs: an autonomous capability-generation engine — discovers an uncovered opportunity category, has an LLM write a new monitor for it, sandbox-verifies it (node:vm, no fs/process/require), and ships it live with zero human step if it passes.
- A smart-contract AUDIT pipeline (Slither + Aderyn + Foundry) for public-goods security, diff-aware so it re-audits only changed code.
- Multi-chain wallet: EVM, Solana, Bitcoin, Cosmos, Sui, Aptos, Near addresses all derived from one seed.
- An open-core public signal FEED (RSS/JSON) — free tier for the commons, pro tier sustains it.
- 100% keyless / free public data sources (DefiLlama, Hyperliquid, CoinGecko, Snapshot, Deribit, public RPCs) — no proprietary data moats, fully reproducible.
STRENGTHS FOR HACKATHONS: a real running system with public commit history (not a hackathon-weekend prototype), genuinely autonomous (an LLM writes and ships its own new monitors, verified live), keyless/open-source, solo independent builder.
HONESTY CONSTRAINT: do not invent metrics, users, demo videos, or team members we don't have. Do not claim a custom build was made specifically for this hackathon unless the fit is about wiring the EXISTING system's real output into the hackathon's track.`;

async function llm(prompt, { maxTokens = 1400, temperature = 0.4 } = {}) {
  try {
    const r = await fetch(LLM_URL, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-mesh' },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const body = (m[1] || text).trim();
  const start = body.search(/[[{]/); if (start < 0) return null;
  try { return JSON.parse(body.slice(start)); } catch {}
  try { const a = body.indexOf('['), b = body.lastIndexOf(']'); if (a >= 0 && b > a) return JSON.parse(body.slice(a, b + 1)); } catch {}
  return null;
}

async function loadHackathons() {
  const r = await runMonitor({ template: 'hackathon-watch', id: 'hf-hack', params: {} });
  return (r.alerts || []).map((a) => ({ name: a.title, focus: (a.themes || []).join(', '), url: a.url, prize: a.prize }));
}

async function scoreFit(hackathons) {
  if (!hackathons.length) return [];
  const list = hackathons.map((h, i) => `${i}. ${h.name} — themes: ${h.focus} — prize: ${h.prize}`).join('\n');
  const prompt = `Here is our project profile:\n${PROFILE}\n\nHere are currently open hackathons:\n${list}\n\nScore each 0-100 for how well OUR specific project genuinely fits the hackathon's themes/tracks (favor AI-agent, crypto/web3, dev-tooling, security, open-source tracks where a real running autonomous system is a strong fit; score LOW if the theme is unrelated, e.g. pure consumer mobile app or hardware). Return ONLY a JSON array of {"i":<index>,"fit":<0-100>,"reason":"<one line>"}. No prose.`;
  const out = await llm(prompt, { temperature: 0.2, maxTokens: 1500 });
  const parsed = extractJson(out);
  if (!Array.isArray(parsed)) return hackathons.map((h) => ({ ...h, fit: 40, reason: 'LLM scoring unavailable — heuristic default' }));
  const byI = new Map(parsed.map((x) => [x.i, x]));
  return hackathons.map((h, i) => ({ ...h, fit: byI.get(i)?.fit ?? 30, reason: byI.get(i)?.reason || '' })).sort((a, b) => b.fit - a.fit);
}

async function draftEntry(h) {
  const prompt = `Draft a concise, honest hackathon submission writeup for THIS hackathon:\nHackathon: ${h.name} — themes: ${h.focus} (${h.url})\n\nApplicant profile:\n${PROFILE}\n\nWrite a ready-to-submit draft in markdown with sections: Title, One-liner, Problem, What we built (cite the concrete shipped artifacts honestly — do NOT invent a demo/video/team we don't have), Why it fits this hackathon's themes, Tech stack, Links (github.com/sstiempro/mesh), What's left to do before submitting (be specific and honest — e.g. "record a 3-min demo walkthrough", "confirm eligibility rules"). No hype, no fabricated traction. ~350-500 words.`;
  return await llm(prompt, { temperature: 0.5, maxTokens: 1400 });
}

export async function runHackathonFit({ n = 5, draft = true } = {}) {
  if (!existsSync(ENTRIES)) await mkdir(ENTRIES, { recursive: true });
  const hackathons = await loadHackathons();
  const scored = await scoreFit(hackathons);
  const top = scored.filter((h) => h.fit >= 60).slice(0, n); // only draft ones genuinely worth the operator's time
  const drafted = [];
  if (draft) {
    for (const h of top) {
      const md = await draftEntry(h);
      if (!md) { drafted.push({ name: h.name, fit: h.fit, draft: null, note: 'LLM draft unavailable' }); continue; }
      const fp = path.join(ENTRIES, slug(h.name) + '.md');
      try { await writeFile(fp, `<!-- fit ${h.fit} · ${h.reason} · ${h.url} -->\n\n` + md); } catch {}
      drafted.push({ name: h.name, fit: h.fit, url: h.url, draft: `data/hackathon-entries/${slug(h.name)}.md` });
    }
  }
  let queued = 0;
  try {
    const existing = existsSync(QUEUE) ? readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
    const pending = new Set(existing.filter((e) => e.status && e.status !== 'done' && e.status !== 'dismissed').map((e) => e.sig));
    for (const d of drafted.filter((d) => d.draft)) {
      const sig = `hackathon-apply:${slug(d.name)}`;
      if (pending.has(sig)) continue; pending.add(sig);
      await appendFile(QUEUE, JSON.stringify({ lane: 'approve', type: 'hackathon-apply', asset: d.name, action: `Submit to ${d.name} (fit ${d.fit}) — draft ready: ${d.draft}`, needs: 'record a demo + submit under your identity', why: 'hackathon prize', url: d.url, sig, status: 'pending', queued: new Date().toISOString() }) + '\n');
      queued++;
    }
  } catch {}
  const result = { ts: Date.now(), hackathons_scanned: hackathons.length, scored: scored.length, llm: LLM_MODEL, drafted: drafted.length, queued, top: scored.slice(0, 10).map((h) => ({ name: h.name, fit: h.fit, reason: h.reason, url: h.url })), drafts: drafted };
  try { await writeFile(LATEST, JSON.stringify(result, null, 2)); } catch {}
  return result;
}

export async function hackathonFitView() {
  try { return JSON.parse(await readFile(LATEST, 'utf8')); } catch { return { note: 'no HackathonFit run yet — POST /api/hackathonfit/run or call runHackathonFit()', top: [], drafts: [] }; }
}

// cron entry point — only re-run when stale (hackathons rotate faster than grants, but still LLM-cost-bounded)
export async function runHackathonFitIfStale(hours = 6) {
  let age = Infinity;
  try { age = Date.now() - JSON.parse(await readFile(LATEST, 'utf8')).ts; } catch {}
  if (age < hours * 3600e3) return { skipped: true, age_h: +(age / 3600e3).toFixed(1) };
  return await runHackathonFit({ n: 5 });
}
