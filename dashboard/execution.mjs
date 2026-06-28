// execution.mjs — the ORCHESTRATION layer. Turns monitor SIGNALS into ACTIONS with a wired path to
// completion. Three lanes, gated by the hard rails ($0, keyless, operator signs money moves):
//   auto    → executes now, no money/keys (signal-tape for the paper-sim, internal state)
//   deliver → pushes the alert to a destination YOU pre-wired (config/delivery.local.json webhook URL)
//   approve → real-money/identity action → a ready-to-execute card in data/action-queue.jsonl (you click)
// Plus confluence: ≥2 monitors firing on the same asset → one escalated high-conviction action.
// No trade is executed, no transfer, no claim. The agent drafts + routes; the operator executes money moves.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, runMonitor } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAPE = path.join(LAB, 'data', 'signal-tape.jsonl');
const QUEUE = path.join(LAB, 'data', 'action-queue.jsonl');
const FEEDOUT = path.join(LAB, 'data', 'actions-feed.json');
const PLAN = path.join(LAB, 'data', 'execution-plan.json');
const PUBLICFEED = path.join(LAB, 'data', 'public-feed.json'); // the always-on free-tier product (served at /api/feed)
const DELIVERY = path.join(LAB, 'config', 'delivery.local.json'); // gitignored; operator fills once for pro realtime push

const jsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

// ── routing: monitor template → action(s) with a lane each ──
const ROUTE = {
  'stable-depeg': (a) => [
    { lane: 'deliver', type: 'depeg-alert', asset: a.id, msg: `${a.id} ${a.side} ${a.deviation} (px ${a.price})` },
    { lane: 'approve', type: 'arb', asset: a.id, action: `Buy ${a.id} at ${a.side} ${a.deviation}, unwind on repeg`, needs: 'capital + venue', why: 'mean-revert to $1' },
  ],
  'tvl-drain': (a) => [
    { lane: 'deliver', type: 'exploit-early-warning', asset: a.name, priority: 'high', msg: `⚠ ${a.name} (${a.category}) TVL −${a.drop} (${a.was?.toLocaleString?.()}→${a.tvl?.toLocaleString?.()})` },
    { lane: 'approve', type: 'derisk', asset: a.name, action: `If exposed to ${a.name}: withdraw/exit now`, needs: 'position check', why: 'possible exploit / mass-exit' },
  ],
  'funding-extreme': (a) => [
    { lane: 'auto', type: 'paper-signal', asset: a.symbol, signal: `funding ${a.funding} → ${a.side}`, sink: 'signal-tape' },
    { lane: 'deliver', type: 'funding-feed', asset: a.symbol, msg: `${a.symbol} funding ${a.funding} — ${a.side}` },
  ],
  'yield-spike': (a) => [
    { lane: 'deliver', type: 'yield-radar', asset: a.pool, msg: `${a.pool} ${a.apy} APY · $${a.tvl?.toLocaleString?.()} · ${a.chain}` },
    { lane: 'approve', type: 'deploy', asset: a.pool, action: `Evaluate ${a.pool} @ ${a.apy} APY (${a.chain})`, needs: 'capital + risk check', why: 'real yield' },
  ],
  'gas-watch': (a) => [{ lane: 'auto', type: 'tx-timing', asset: a.chain, signal: `${a.gwei} gwei`, sink: 'signal-tape' }],
  'sentiment-flip': (a) => [
    { lane: 'auto', type: 'regime', asset: 'MARKET', signal: a.trigger, sink: 'signal-tape' },
    { lane: 'deliver', type: 'regime-feed', asset: 'MARKET', msg: a.trigger },
  ],
};

async function route() {
  const reg = await loadRegistry();
  const actions = [];
  for (const m of (reg.monitors || [])) {
    const r = await runMonitor(m);
    if (!r.ok) continue;
    const fn = ROUTE[r.template]; if (!fn) continue;
    for (const a of (r.alerts || [])) for (const act of fn(a)) actions.push({ ...act, monitor: r.label, template: r.template, monetize: r.monetize, ts: Date.now() });
  }
  return actions;
}

// confluence: same asset flagged by ≥2 different monitor templates = escalate
function confluence(actions) {
  const byAsset = {};
  for (const a of actions) { if (!a.asset || a.asset === 'MARKET') continue; (byAsset[a.asset] ||= new Set()).add(a.template); }
  const hits = [];
  for (const [asset, templates] of Object.entries(byAsset)) {
    if (templates.size >= 2) hits.push({ lane: 'approve', type: 'confluence', asset, priority: 'high', action: `HIGH CONVICTION: ${asset} flagged by ${[...templates].join(' + ')} — review`, why: 'multi-signal confirmation', templates: [...templates], ts: Date.now() });
  }
  return hits;
}

async function deliver(actions) {
  // FREE-TIER delivery is ALWAYS-ON: publish to the public feed (rolling window), served live at /api/feed.
  // This is the open-core free product — any consumer can poll it. No config needed; it just flows.
  let prev = []; try { prev = JSON.parse(readFileSync(PUBLICFEED, 'utf8')).alerts || []; } catch {}
  const stamped = actions.map(a => ({ ts: new Date().toISOString(), type: a.type, asset: a.asset, msg: a.msg, priority: a.priority || 'normal', monetize: a.monetize }));
  const rolled = [...stamped, ...prev].slice(0, 200);
  await writeFile(PUBLICFEED, JSON.stringify({ updated: new Date().toISOString(), count: rolled.length, alerts: rolled }, null, 2));
  const out = { published: actions.length, channels: ['public-feed'], feed: '/api/feed', webhooks_sent: 0, results: [] };
  // PRO realtime: ADDITIONAL push to operator-wired webhooks, if configured
  let dest = null; try { dest = JSON.parse(await readFile(DELIVERY, 'utf8')); } catch {}
  const webhooks = dest?.webhooks || [];
  out.destinations = webhooks.length;
  if (webhooks.length) {
    const payload = { source: 'mesh-monitors', ts: new Date().toISOString(), alerts: stamped };
    for (const url of webhooks) {
      try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) }); out.webhooks_sent += r.ok ? 1 : 0; out.results.push({ url: url.slice(0, 28) + '…', ok: r.ok }); }
      catch (e) { out.results.push({ url: url.slice(0, 28) + '…', ok: false, err: String(e).slice(0, 40) }); }
    }
    out.channels.push('webhook');
  } else { out.note = 'free tier flowing to /api/feed · add a webhook to config/delivery.local.json for pro realtime push'; }
  return out;
}

// approve queue — append only NEW cards (dedupe by type:asset against still-pending), so it doesn't spam each tick
async function queueApprove(actions) {
  const existing = jsonl(QUEUE);
  const pendingSig = new Set(existing.filter(e => e.status !== 'done' && e.status !== 'dismissed').map(e => `${e.type}:${e.asset}`));
  let added = 0;
  for (const a of actions) {
    const sig = `${a.type}:${a.asset}`; if (pendingSig.has(sig)) continue;
    pendingSig.add(sig);
    await appendFile(QUEUE, JSON.stringify({ ...a, sig, status: 'pending', queued: new Date().toISOString() }) + '\n'); added++;
  }
  return { added, pending: pendingSig.size };
}

export async function orchestrate() {
  const base = await route();
  const conf = confluence(base);
  const actions = [...conf, ...base]; // confluence first (highest conviction)
  const auto = actions.filter(a => a.lane === 'auto');
  const del = actions.filter(a => a.lane === 'deliver');
  const app = actions.filter(a => a.lane === 'approve');

  // AUTO: execute now — write the signal tape (the paper-sim handoff). Real artifact, no money.
  for (const a of auto) await appendFile(TAPE, JSON.stringify({ ...a, executed: new Date().toISOString() }) + '\n');
  // DELIVER: push to operator-wired destinations (or arm)
  const delivered = await deliver(del);
  await writeFile(FEEDOUT, JSON.stringify({ ts: Date.now(), alerts: del.map(a => ({ type: a.type, asset: a.asset, msg: a.msg, priority: a.priority || 'normal', monetize: a.monetize })) }, null, 2));
  // APPROVE: queue ready-to-click cards
  const queued = await queueApprove(app);

  const plan = {
    ts: Date.now(),
    routed: actions.length, confluence: conf.length,
    auto: { count: auto.length, executed: auto.length, sink: 'data/signal-tape.jsonl' },
    deliver: { count: del.length, ...delivered },
    approve: { count: app.length, ...queued, queue: 'data/action-queue.jsonl' },
    confluence_hits: conf.map(c => ({ asset: c.asset, by: c.templates })),
    sample_actions: actions.slice(0, 10).map(a => ({ lane: a.lane, type: a.type, asset: a.asset, do: a.action || a.msg || a.signal })),
    note: 'auto = executed (signal-tape) · deliver = pushed to your webhook (or armed) · approve = cards you click. No trade/transfer/claim is auto-executed — you sign money moves.',
  };
  await writeFile(PLAN, JSON.stringify(plan, null, 2));
  return plan;
}

// fast read for the endpoint — serves the last cron-written plan + the live approve queue.
// Collapses the append-only queue by sig (last status wins) so done/dismissed cards drop off.
export async function executionView() {
  let plan = null; try { plan = JSON.parse(await readFile(PLAN, 'utf8')); } catch {}
  const bySig = new Map();
  for (const e of jsonl(QUEUE)) if (e.sig) bySig.set(e.sig, { ...(bySig.get(e.sig) || {}), ...e });
  const pending = [...bySig.values()].filter(e => e.status === 'pending').slice(-20).reverse();
  return { ...(plan || { note: 'no plan yet — runs each builder tick' }), pending_actions: pending, pending_count: pending.length };
}

// PUBLIC FEED — the always-on free-tier product. JSON by default, RSS so it's actually subscribable.
export async function publicFeed(format = 'json') {
  let f = { updated: null, count: 0, alerts: [] }; try { f = JSON.parse(await readFile(PUBLICFEED, 'utf8')); } catch {}
  if (format === 'rss') {
    const items = (f.alerts || []).slice(0, 50).map(a => `    <item><title>${esc(`[${a.type}] ${a.asset || ''} ${a.msg || ''}`)}</title><description>${esc(a.msg || '')}</description><pubDate>${new Date(a.ts).toUTCString()}</pubDate><guid isPermaLink="false">${esc((a.ts || '') + (a.asset || '') + a.type)}</guid></item>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n    <title>mesh — keyless crypto signal feed</title>\n    <link>https://github.com/sstiempro/mesh</link>\n    <description>Stablecoin depegs, TVL-drain early-warning, funding extremes, yield radar — free tier.</description>\n${items}\n</channel></rss>`;
  }
  return { ...f, tiers: { free: 'this feed (delayed/digest)', pro: 'realtime webhook push — config/delivery.local.json' },
    note: 'Open-core free tier. Live keyless signals published every builder tick.' };
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// SIGNAL TAPE — the AUTO-lane consumer. Reads the tape, digests it into the current market posture so
// the auto signals actually FEED something readable (the paper-sim handoff + a queryable state).
export async function signalTapeView() {
  const tape = jsonl(TAPE).slice(-200);
  const latest = {};
  for (const t of tape) { const k = `${t.type}:${t.asset || ''}`; latest[k] = t; }
  const funding = Object.values(latest).filter(t => t.type === 'paper-signal');
  const regime = Object.values(latest).filter(t => t.type === 'regime');
  const gas = Object.values(latest).filter(t => t.type === 'tx-timing');
  return { tape_size: tape.length, posture: {
      regime: regime.map(r => r.signal), funding_skews: funding.slice(0, 12).map(f => ({ asset: f.asset, signal: f.signal })),
      gas: gas.map(g => ({ chain: g.asset, signal: g.signal })) },
    recent: tape.slice(-15).reverse(),
    note: 'AUTO-lane signals, digested into current posture. This is the handoff a paper-sim/strategist reads — queryable at /api/signal-tape.' };
}

// operator resolves a card from the dashboard: mark it done/dismissed (append-only status update)
export async function resolveAction(sig, status) {
  if (!sig || !['done', 'dismissed', 'pending'].includes(status)) return { ok: false, error: 'need sig + status(done|dismissed)' };
  await appendFile(QUEUE, JSON.stringify({ sig, status, ts: new Date().toISOString() }) + '\n');
  return { ok: true, sig, status };
}
