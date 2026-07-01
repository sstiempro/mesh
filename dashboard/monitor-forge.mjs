// monitor-forge.mjs — the actual autonomous cruncher. Not another queue, not a card that tells the
// operator what to build: this DISCOVERS a genuinely new opportunity category, asks the LLM to WRITE a
// real monitor for it, sandbox-tests it against live data, and — only if it passes — ships it straight
// into the live registry (config/monitors.json). No human step. If it fails, it's quarantined and logged,
// never wired. This is what "AI auto-crunching" means as running code, not as a to-do list.
//
// WHY THIS EXISTS: idea-gen.mjs's autoGrid() only ever remixes PARAMETERS of the ~24 hand-written
// TEMPLATES in monitors.mjs (new thresholds, new chains) — it cannot invent a monitor for a shape of
// opportunity nobody coded a template for yet. This closes that gap: brand-new TEMPLATE CODE, generated,
// verified, and run, with zero human writing a line of it.
//
// SAFETY MODEL (read before touching):
//  1. Generated source NEVER runs with real Node capabilities. It executes inside node:vm with a
//     minimal global surface (fetch, AbortSignal, gjT, JSON, Math [no random], Date, String, Number,
//     Array, Object, Boolean, Promise, console.log-only) — no require, no process, no fs, no
//     child_process, no import(). This is true on EVERY run, not just the first — a forged monitor that
//     starts misbehaving after being trusted is bounded exactly like day one.
//  2. A static denylist rejects source containing common vm-escape idioms (constructor-chain access,
//     `Function(`, `globalThis`, `__proto__`) BEFORE it is ever compiled — defense in depth on top of the
//     sandbox's absent globals, not a replacement for it.
//  3. Honesty about limits: Node's `vm` module is a determined-attacker-escapable boundary, not a true
//     security isolate (Node's own docs say so). The threat model here is "the operator's own trusted LLM
//     gateway writes buggy code," not "an adversary crafts a jailbreak" — this is proportionate to that,
//     not a claim of bulletproof sandboxing. If this is ever pointed at untrusted/adversarial LLM output,
//     it needs a real isolate (worker_threads + a fresh V8 context, or a container) instead.
//  4. Verify-before-register: exactly the knockDown() pattern already proven in tools/builder-tick.mjs —
//     a forged monitor must return a valid {ok:true,...} shape on a REAL test invocation before it is
//     EVER written into the live registry. Anything else is quarantined (kept on disk, logged, never wired).
//  5. Discovery-only capability. A generated monitor can only ever produce {ok,level,signal,alerts} — the
//     same shape every hand-written template produces. It is fed through the EXACT SAME execution.mjs
//     ROUTE/approve gate as everything else; it cannot touch money or identity, because nothing here
//     grants it a different lane than any other monitor.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
// circular with monitors.mjs (it imports runGeneratedMonitor from here) — safe because withRegistryLock is
// only ever CALLED from inside forgeMonitor(), well after both modules finish their top-level evaluation.
import { withRegistryLock } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENDIR = path.join(LAB, 'dashboard', 'generated-monitors');
const SEEN = path.join(LAB, 'data', 'forge-seen-categories.json');
const LEDGER = path.join(LAB, 'data', 'build-ledger.jsonl');
const FORGE_LOG = path.join(LAB, 'data', 'forge-latest.json');
const LLM_URL = process.env.MESH_LLM_URL || 'http://TAILNET_IP:4000/v1/chat/completions';
const LLM_MODEL = process.env.MESH_LLM_MODEL || 'sstiem-big-free';

const jsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ── SAFETY: static denylist for vm-escape idioms (defense in depth; the real boundary is the absent globals) ──
const FORBIDDEN = /\b(require\s*\(|import\s*\(|process\s*[.[]|child_process|globalThis|__proto__|constructor\s*[.[]|this\s*\.\s*constructor|new\s+Function\s*\(|Function\s*\(|WebAssembly|Reflect\s*\.)/;

async function gjT(u, ms = 9000) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'mesh-monitor-forged' } }); return await r.json(); }
  catch { return null; }
}

// run generated `async function monitor(params) {...}` source inside a locked-down vm context.
// Bounds BOTH the sync portion (vm timeout option) and the async completion (Promise.race).
export function sandboxRun(source, params, timeoutMs = 9000) {
  if (typeof source !== 'string' || !source.includes('function monitor')) return Promise.resolve({ ok: false, signal: 'rejected: no monitor() function in source' });
  if (FORBIDDEN.test(source)) return Promise.resolve({ ok: false, signal: 'rejected: forbidden token in generated source' });
  // Math's methods are non-enumerable own properties — {...Math} silently produces an EMPTY object
  // (verified: Object.keys({...Math}) === []). Must copy via getOwnPropertyNames, not spread.
  const safeMath = {};
  for (const k of Object.getOwnPropertyNames(Math)) safeMath[k] = Math[k];
  safeMath.random = undefined;
  const context = vm.createContext({
    fetch, AbortSignal, gjT, JSON, Math: safeMath, Date, String, Number, Array, Object, Boolean, Promise,
    console: { log() {} }, params,
  });
  const wrapped = `(async () => {\n${source}\nif (typeof monitor !== 'function') throw new Error('generated source must define async function monitor(params)');\nreturn await monitor(params);\n})()`;
  let script;
  try { script = new vm.Script(wrapped); } catch (e) { return Promise.resolve({ ok: false, signal: 'compile error: ' + String(e).slice(0, 120) }); }
  let resultPromise;
  try { resultPromise = script.runInContext(context, { timeout: timeoutMs }); }
  catch (e) { return Promise.resolve({ ok: false, signal: 'sync exec error: ' + String(e).slice(0, 120) }); }
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('async timeout (' + timeoutMs + 'ms)')), timeoutMs));
  return Promise.race([resultPromise, timeout])
    .then((res) => {
      if (!res || typeof res !== 'object') return { ok: false, signal: 'no result object returned' };
      return { ok: !!res.ok, level: res.level || (res.ok ? 'ok' : 'down'), signal: String(res.signal || '').slice(0, 200), alerts: Array.isArray(res.alerts) ? res.alerts.slice(0, 20) : [] };
    })
    .catch((e) => ({ ok: false, signal: String(e && e.message || e).slice(0, 140) }));
}

// ── discover a genuinely new, uncovered opportunity category from a live source ──
async function discoveredCategories() {
  const j = await gjT('https://api.llama.fi/protocols', 12000);
  if (!Array.isArray(j)) return [];
  const counts = {};
  for (const x of j) if (x.category) counts[x.category] = (counts[x.category] || 0) + 1;
  return Object.entries(counts).filter(([, n]) => n >= 3).map(([cat]) => cat).sort();
}
async function loadSeen() { try { return JSON.parse(await readFile(SEEN, 'utf8')); } catch { return { attempted: [] }; } }
async function saveSeen(s) { try { await writeFile(SEEN, JSON.stringify(s, null, 2)); } catch {} }

export async function nextOpportunity() {
  const cats = await discoveredCategories();
  if (!cats.length) return null;
  const seen = await loadSeen();
  const attempted = new Set(seen.attempted || []);
  return cats.find((c) => !attempted.has(c)) || null;
}

// ── LLM drafts the monitor source ──
function extractCode(text) {
  if (!text) return null;
  const m = text.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}
async function draftMonitorSource(category) {
  const prompt = `Write ONE JavaScript async function named exactly "monitor" with signature "async function monitor(params) { ... }" that implements a keyless crypto monitor for the DeFiLlama protocol category "${category}".

Available globals ONLY (nothing else exists — no require/import/fs/process): fetch, AbortSignal, gjT(url, timeoutMs=9000) — a helper that does "try { const r = await fetch(url,{signal:AbortSignal.timeout(timeoutMs)}); return await r.json(); } catch { return null; }" — prefer gjT for any HTTP call. Also available: JSON, Math (no Math.random), Date, String, Number, Array, Object, Boolean, Promise, console.log.

The function must:
- Fetch https://api.llama.fi/protocols (keyless, no auth) via gjT, filter to protocols where category === "${category}", and compute something genuinely useful about them RIGHT NOW (e.g. a TVL threshold cross, a concentration/dominance stat, a notable outlier) using only fields already present on each protocol object (name, category, tvl, chains, change_1h, change_1d, change_7d — check what's actually present, don't assume fields that might not exist).
- Return exactly this shape: { ok: true|false, level: 'ok'|'alert'|'signal'|'down', signal: '<short human summary string>', alerts: [ {...a few relevant fields per flagged item, plain objects only} ] }. alerts should be an EMPTY array when nothing is currently notable — that is a normal, correct result, not a failure.
- Handle a null/failed fetch by returning { ok: false }.
- Take an optional params object (may be empty {}) for tunable thresholds with sane defaults via params.foo ?? default.
- Be fully self-contained, deterministic given its inputs, and complete within a few seconds.

Return ONLY the function in a single \`\`\`js code block. No explanation, no imports, no example usage, nothing else.`;
  const out = await llm(prompt);
  return extractCode(out);
}
async function llm(prompt) {
  try {
    const r = await fetch(LLM_URL, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-mesh' },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.25, max_tokens: 1200 }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ── forge one new monitor end to end: discover → draft → sandbox-verify → ship or quarantine ──
export async function forgeMonitor(category) {
  const seen = await loadSeen();
  seen.attempted = seen.attempted || [];
  const record = (outcome, extra = {}) => {
    if (!seen.attempted.includes(category)) seen.attempted.push(category);
    return saveSeen(seen).then(() => ({ category, outcome, ...extra }));
  };
  const source = await draftMonitorSource(category);
  if (!source) return record('draft-failed', { reason: 'LLM draft unavailable' });

  const test = await sandboxRun(source, {});
  const id = `gen-${slug(category)}`;
  if (!existsSync(GENDIR)) await mkdir(GENDIR, { recursive: true });
  const file = path.join(GENDIR, `${slug(category)}.mjs`);
  // always keep the source on disk (quarantined or shipped) — nothing generated is silently lost.
  await writeFile(file, `// forged ${new Date().toISOString()} for category "${category}" — verify result: ${JSON.stringify(test)}\n${source}\n`);

  // exactly the same bar as knockDown() applies to a hand-written monitor: test.ok must be true, full stop.
  // (an empty-alerts scan is a NORMAL result the contract requires monitor() to report as ok:true — see the
  // LLM prompt. ok:false always means the run itself failed, whatever the error text says — a prior version
  // of this gate tried to pattern-match specific error strings and let anything else through, which shipped
  // a monitor that threw "Math.abs is not a function" on every real run. Trust the flag, not the message.)
  if (!test.ok) {
    await appendLedger({ action: 'forge-quarantined', id, category, reason: test.signal });
    return record('quarantined', { reason: test.signal, file: path.relative(LAB, file) });
  }
  // valid, verified result → register it live, same as knockDown() commits a verified monitor.
  // Locked: config/monitors.json is also written by the 5-min cron's knockDown() — an unlocked
  // read-modify-write here silently lost a real forged monitor to that race (confirmed live before this fix).
  // Dedup by id: re-forging a category (e.g. after clearing forge-seen-categories.json) must not double-
  // register the same monitor — confirmed live it otherwise ran/alerted twice per tick.
  await withRegistryLock((reg) => {
    if (reg.monitors.some((m) => m.id === id)) return;
    reg.monitors.push({ id, template: `gen:${slug(category)}`, label: `Forged: ${category}`, params: {}, monetize: 'autonomously generated — verify value before selling as a product' });
  });
  await appendLedger({ action: 'forge-shipped', id, category, first_signal: test.signal, file: path.relative(LAB, file) });
  return record('shipped', { id, first_signal: test.signal, file: path.relative(LAB, file) });
}
async function appendLedger(o) { try { const { appendFile } = await import('node:fs/promises'); await appendFile(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n'); } catch {} }

// ── run a previously-shipped generated monitor (called by monitors.mjs's runMonitor() for template 'gen:*') ──
export async function runGeneratedMonitor(templateId, params) {
  const genSlug = templateId.replace(/^gen:/, '');
  const file = path.join(GENDIR, `${genSlug}.mjs`);
  if (!existsSync(file)) return { ok: false, signal: 'generated source missing on disk' };
  const src = readFileSync(file, 'utf8');
  return sandboxRun(src, params || {});
}

// ── cron entry point: attempt at most one new forge per window (LLM cost + keep the loop bounded) ──
export async function forgeIfStale(hours = 12) {
  let age = Infinity;
  try { age = Date.now() - JSON.parse(await readFile(FORGE_LOG, 'utf8')).ts; } catch {}
  if (age < hours * 3600e3) return { skipped: true, age_h: +(age / 3600e3).toFixed(1) };
  const category = await nextOpportunity();
  const out = category ? await forgeMonitor(category) : { outcome: 'no-new-category' };
  const result = { ts: Date.now(), ...out };
  try { await writeFile(FORGE_LOG, JSON.stringify(result, null, 2)); } catch {}
  return result;
}
export async function forgeView() { try { return JSON.parse(await readFile(FORGE_LOG, 'utf8')); } catch { return { note: 'no forge run yet' }; } }
