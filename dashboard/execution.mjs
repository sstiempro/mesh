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

// ── canonical asset key — so monitors that name the SAME project differently (tvl-drain "Aave V3",
// defi-hack "Aave", funding "AAVE", depeg coingecko-id "tether") converge for confluence(). The unlock
// from the creative sweep: the 3 highest-value monitors emitted different key shapes, so they never fused.
const PROTO2SYM = {
  tether: 'USDT', 'usd-coin': 'USDC', dai: 'DAI', 'first-digital-usd': 'FDUSD', 'paypal-usd': 'PYUSD', frax: 'FRAX', 'ethena-usde': 'USDE', 'ondo-us-dollar-yield': 'USDY', rlusd: 'RLUSD',
  aave: 'AAVE', lido: 'LDO', 'ether.fi': 'ETHFI', etherfi: 'ETHFI', pendle: 'PENDLE', ethena: 'ENA', arbitrum: 'ARB', optimism: 'OP', curve: 'CRV', 'curve-dex': 'CRV', uniswap: 'UNI', jupiter: 'JUP', celestia: 'TIA', dydx: 'DYDX', wormhole: 'W', jito: 'JTO', pyth: 'PYTH', sui: 'SUI', aptos: 'APT', starknet: 'STRK', 'sei-network': 'SEI', maker: 'MKR', sky: 'USDS',
};
function normAsset(asset) {
  if (!asset || asset === 'MARKET') return asset;
  const low = String(asset).toLowerCase().trim();
  if (PROTO2SYM[low]) return PROTO2SYM[low];
  const cleaned = low.replace(/\s+(v\d+|finance|protocol|dex|exchange|network|labs|ecosystem|chain)\b/g, '').trim();
  if (PROTO2SYM[cleaned]) return PROTO2SYM[cleaned];
  if (/^[a-z0-9]{2,6}$/.test(low)) return low.toUpperCase(); // already a ticker
  return cleaned.replace(/\s+/g, '-').toUpperCase().slice(0, 14);
}

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
  // ── newly wired (were orphaned): signal monitors ──
  'stablecoin-flow': (a) => [
    { lane: 'deliver', type: 'capital-flow', asset: a.symbol, msg: `${a.symbol} supply ${a.flow} ${a.dayChange}/day (wk ${a.weekChange})` },
    { lane: 'auto', type: 'flow-signal', asset: a.symbol, signal: `${a.flow} ${a.dayChange}`, sink: 'signal-tape' },
  ],
  'funding-arb': (a) => [
    { lane: 'deliver', type: 'funding-arb', asset: a.coin, msg: `${a.coin} cross-venue funding ${a.spread8h}/8h (${a.annualized} annl) — ${a.play}` },
    { lane: 'auto', type: 'paper-signal', asset: a.coin, signal: `funding-arb ${a.spread8h} ${a.play}`, sink: 'signal-tape' },
  ],
  'defi-hack-watch': (a) => [
    { lane: 'deliver', type: 'exploit-confirmed', asset: a.name, priority: 'high', msg: `🚨 EXPLOIT: ${a.name} lost ${a.lost} (${a.technique}, ${a.chain})` },
    { lane: 'approve', type: 'derisk', asset: a.name, action: `If exposed to ${a.name}: exit now`, needs: 'position check', why: a.technique },
  ],
  'governance-watch': (a) => [
    { lane: 'deliver', type: 'governance', asset: a.space, msg: `${a.space}: "${a.title}" closes ${a.closesIn} (${a.votes} votes)` },
  ],
  'vol-regime': (a) => [
    { lane: 'auto', type: 'regime', asset: 'MARKET', signal: `${a.cur} DVOL ${a.dvol} — ${a.regime}`, sink: 'signal-tape' },
    { lane: 'deliver', type: 'vol-regime', asset: a.cur, msg: `${a.cur} DVOL ${a.dvol} (${a.regime}) ${a.change}` },
  ],
  'token-unlock-watch': (a) => [
    { lane: 'deliver', type: 'unlock-calendar', asset: a.token, msg: `${a.token} unlock in ${a.inDays}d: ${a.tokens?.toLocaleString?.()} tokens (${a.category})` },
    { lane: 'auto', type: 'paper-signal', asset: a.token, signal: `unlock ${a.inDays}d sell-pressure`, sink: 'signal-tape' },
  ],
  'world-pulse': (a) => [{ lane: 'deliver', type: 'prediction-odds', asset: 'MARKET', msg: `${a.q}: ${a.prob} (${a.moved})` }],
  'narrative-rotation': (a) => [
    { lane: 'deliver', type: 'narrative', asset: a.narrative, msg: `narrative rotating in: ${a.narrative} ${a.chg24h} ($${a.vol} vol)` },
    { lane: 'auto', type: 'regime', asset: 'MARKET', signal: `narrative: ${a.narrative} ${a.chg24h}`, sink: 'signal-tape' },
  ],
  'prediction-whale': (a) => [{ lane: 'deliver', type: 'prediction-whale', asset: 'MARKET', msg: `whale ${a.side} ${a.notional} @ ${a.prob}: ${a.market}` }],
  // ── newly wired: opportunity scanners → approve-cards (the discover→crunch→ship loop) ──
  'audit-contest-watch': (a) => [{ lane: 'approve', type: 'run-audit', asset: a.title, action: `Fresh ${a.board} contest: ${a.title} (${a.prize}) — confirm the repo URL so the audit pipeline can auto-run on day-1 code`, needs: 'paste repo URL into config/audit-targets.json needs_repo entry (one-time, no identity) + later submit under your identity', why: 'low-dup findings', url: a.url }],
  // hackathon-watch: hackathon-fit.mjs (built 2026-07-01) now independently consumes this SAME monitor and
  // cards a real 'hackathon-apply' draft — same reason grants-watch was removed from ROUTE below: routing
  // it here too would duplicate a dead-end card alongside the real drafted one.
  // grants-watch: grant-fit.mjs already consumes this SAME monitor and cards a real 'grant-apply' draft —
  // routing it here too used to duplicate a dead-end 'apply-grant' card with no draft behind it (found in
  // the 2026-07-01 audit). Removed; grant-fit.mjs is the one real path for this monitor.
  // ── fused 2nd-order signals ──
  'depeg-doctor': (a) => [
    { lane: 'deliver', type: 'depeg-doctor', asset: a.stable, priority: a.verdict === 'BREAK-RISK' ? 'high' : 'normal', msg: `${a.stable} ${a.dev} — ${a.verdict}: ${a.why}` },
    ...(a.verdict === 'BREAK-RISK' ? [{ lane: 'approve', type: 'derisk', asset: a.stable, action: `${a.stable} BREAK-RISK — exit/hedge`, needs: 'position check', why: a.why }] : []),
  ],
  'unlock-coil': (a) => [
    { lane: 'deliver', type: 'unlock-coil', asset: a.token, msg: `${a.token} unlock ${a.inDays}d — ${a.setup} (${a.why})` },
    { lane: 'auto', type: 'paper-signal', asset: a.token, signal: `unlock-coil ${a.setup}`, sink: 'signal-tape' },
  ],
  'vol-compression': (a) => [
    { lane: 'deliver', type: 'vol-compression', asset: 'MARKET', priority: 'high', msg: `${a.trigger}: BTC DVOL ${a.dvol} (${a.dvol_pctile}) + ${a.catalysts?.length} catalysts <72h` },
    { lane: 'auto', type: 'regime', asset: 'MARKET', signal: `vol compressed ${a.dvol_pctile}`, sink: 'signal-tape' },
  ],
  'github-velocity': (a) => [{ lane: 'deliver', type: 'dev-velocity', asset: a.topic, msg: `${a.topic}: ${a.active_repos_7d?.toLocaleString?.()} active repos/7d` }],
  'prediction-vs-perp': (a) => [
    { lane: 'deliver', type: 'crowd-disagreement', asset: a.coin, msg: `${a.coin}: Polymarket ${a.pm_p_up} up vs funding ${a.funding8h} — ${a.read}` },
    { lane: 'auto', type: 'paper-signal', asset: a.coin, signal: `pred-vs-perp ${a.read}`, sink: 'signal-tape' },
  ],
  'governance-alpha': (a) => [{ lane: 'deliver', type: 'governance-alpha', asset: a.space, priority: /DECIDED/.test(a.status) ? 'high' : 'normal', msg: `${a.space}: "${a.title}" ${a.status} — leading "${a.leading}" (${a.conviction}), closes ${a.closesIn}` }],
  'airdrop-eligibility-confluence': (a) => [
    { lane: 'approve', type: 'airdrop-confluence', asset: a.protocol, priority: a.is_new ? 'high' : 'normal', action: `${a.wallet} already has ${a.tx_count} tx on ${a.chain} — ${a.protocol} (${a.category}, $${a.tvl?.toLocaleString?.()} TVL) is a live tokenless candidate there. Go interact now to build eligibility before any snapshot.`, needs: 'wallet interaction (you sign)', why: 'wallet already active on the matching chain + fresh airdrop candidate', url: a.url },
    { lane: 'deliver', type: 'airdrop-confluence', asset: a.protocol, msg: `${a.protocol} (${a.chain}) — ${a.wallet} active there (${a.tx_count} tx); ${a.is_new ? 'NEW' : 'live'} tokenless candidate` },
  ],
};

// generic fallback for monitor-forge.mjs's autonomously-generated templates ('gen:*') — they don't get a
// hand-written ROUTE entry (nobody wrote one), so without this their alerts would silently vanish the
// moment they shipped. Generic delivery: publish to the free feed + log to the signal-tape. No approve
// lane by default (a freshly forged monitor hasn't earned operator trust yet) — promote it to a real
// ROUTE entry once its output is reviewed and judged worth acting on.
function genericRoute(a, template) {
  return [
    { lane: 'deliver', type: 'forged-signal', asset: a.name || a.id || a.asset || 'MARKET', msg: `[${template}] ${JSON.stringify(a).slice(0, 160)}` },
    { lane: 'auto', type: 'forged-signal', asset: a.name || a.id || a.asset || 'MARKET', signal: `${template}: ${JSON.stringify(a).slice(0, 100)}`, sink: 'signal-tape' },
  ];
}

async function route() {
  const reg = await loadRegistry();
  const actions = [];
  for (const m of (reg.monitors || [])) {
    const r = await runMonitor(m);
    if (!r.ok) continue;
    const fn = ROUTE[r.template] || (String(r.template || '').startsWith('gen:') ? (a) => genericRoute(a, r.template) : null);
    if (!fn) continue;
    for (const a of (r.alerts || [])) for (const act of fn(a)) actions.push({ ...act, monitor: r.label, template: r.template, monetize: r.monetize, ts: Date.now() });
  }
  return actions;
}

// confluence: same (canonical) asset flagged by ≥2 different monitor templates = escalate.
// Keys on normAsset() so "Aave V3"/"Aave"/"AAVE" converge. Opportunity lanes (run-audit/ship-hackathon/
// apply-grant) are excluded — a contest title is not an asset and shouldn't pollute confluence.
const OPP_TYPES = new Set(['run-audit', 'ship-hackathon', 'apply-grant']);
function confluence(actions) {
  const byAsset = {};
  for (const a of actions) {
    if (OPP_TYPES.has(a.type)) continue;
    const key = normAsset(a.asset);
    if (!key || key === 'MARKET') continue;
    (byAsset[key] ||= { templates: new Set(), raw: new Set() });
    byAsset[key].templates.add(a.template); byAsset[key].raw.add(a.asset);
  }
  const hits = [];
  for (const [asset, { templates, raw }] of Object.entries(byAsset)) {
    if (templates.size >= 2) hits.push({ lane: 'approve', type: 'confluence', asset, priority: 'high', action: `HIGH CONVICTION: ${asset} flagged by ${[...templates].join(' + ')} (${[...raw].join(', ')}) — review`, why: 'multi-signal confirmation', templates: [...templates], ts: Date.now() });
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
  const allPending = [...bySig.values()].filter(e => e.status === 'pending');
  // rank high-priority + freshest first; surface ALL (true count, no silent truncation), cap rendered payload at 60.
  const ranked = allPending.sort((a, b) => (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0) || String(b.queued || '').localeCompare(String(a.queued || '')));
  return { ...(plan || { note: 'no plan yet — runs each builder tick' }), pending_actions: ranked.slice(0, 60), pending_count: allPending.length };
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

// REGIME CLOCK — the creative-sweep #2 ship. Fuses three keyless macro feeds into one risk-on/off state,
// lookahead-free, written to the signal-tape so the paper book can gate on it (the internal income edge):
//   stablecoin-flow (net mint=inflow/risk-on, burn=outflow/risk-off) + funding bias (crowded longs=greed) +
//   Fear&Greed (with a contrarian overlay at extremes). Internal/autonomous — no money, no operator click.
const REGIME = path.join(LAB, 'data', 'regime-latest.json');
export async function regimeClock() {
  const [flow, fund, fng] = await Promise.all([
    runMonitor({ template: 'stablecoin-flow', id: 'rc-flow', params: {} }),
    runMonitor({ template: 'funding-extreme', id: 'rc-fund', params: {} }),
    runMonitor({ template: 'sentiment-flip', id: 'rc-fng', params: {} }),
  ]);
  const flowNet = flow.ok ? flow.alerts.reduce((s, a) => s + (parseFloat(a.dayChange) || 0), 0) : 0;
  const flowScore = Math.max(-1, Math.min(1, flowNet / 5)); // ±5% net daily supply = full tilt
  let lp = 0, sp = 0; if (fund.ok) for (const a of fund.alerts) { if (/longs pay/.test(a.side)) lp++; else sp++; }
  const fundScore = (lp + sp) ? (lp - sp) / (lp + sp) : 0;
  const fngVal = fng.ok ? (parseInt((String(fng.signal).match(/F&G (\d+)/) || [])[1]) || 50) : 50;
  const fngScore = (fngVal - 50) / 50;
  const composite = +((flowScore + fundScore + fngScore) / 3).toFixed(3);
  const state = composite > 0.2 ? 'risk-on' : composite < -0.2 ? 'risk-off' : 'neutral';
  const contrarian = fngVal >= 75 ? 'extreme greed → fade rallies / de-risk' : fngVal <= 25 ? 'extreme fear → contrarian long bias' : null;
  const out = {
    ts: Date.now(), state, confidence: +Math.abs(composite).toFixed(2), composite, contrarian,
    components: { stablecoin_flow: { net_day_pct: +flowNet.toFixed(2), score: +flowScore.toFixed(2) }, funding_bias: { longs_pay: lp, shorts_pay: sp, score: +fundScore.toFixed(2) }, fear_greed: { value: fngVal, score: +fngScore.toFixed(2) } },
    note: 'Risk-on/off regime fused from 3 keyless feeds, lookahead-free. The paper book gates entries on this; contrarian overlay flags extremes. Queryable at /api/regime.',
  };
  try { await writeFile(REGIME, JSON.stringify(out, null, 2)); } catch {}
  try { await appendFile(TAPE, JSON.stringify({ type: 'macro-regime', asset: 'MARKET', signal: `${state} (conf ${out.confidence}${contrarian ? '; ' + contrarian : ''})`, executed: new Date().toISOString() }) + '\n'); } catch {}
  return out;
}
export async function regimeView() {
  try { return JSON.parse(await readFile(REGIME, 'utf8')); } catch { return await regimeClock(); }
}

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

// DIGEST — auto-composes a ready-to-post daily thread from the live feed. The "daily auto-posted thread"
// product: generated automatically (real numbers, no hype); the operator or a webhook posts it. Writes
// data/digest-latest.md so it's grab-and-go.
const DIGEST = path.join(LAB, 'data', 'digest-latest.md');
export async function digest() {
  let feed = []; try { feed = JSON.parse(readFileSync(PUBLICFEED, 'utf8')).alerts || []; } catch {}
  const tape = jsonl(TAPE).slice(-200);
  const since = Date.now() - 24 * 3600e3;
  const recent = feed.filter(a => new Date(a.ts).getTime() > since);
  const by = (t) => recent.filter(a => a.type === t);
  const regime = [...tape].reverse().find(t => t.type === 'regime')?.signal || null;
  const exploit = by('exploit-early-warning'), depeg = by('depeg-alert'), yield_ = by('yield-radar'), funding = by('funding-feed');
  const uniq = (arr, n) => [...new Map(arr.map(a => [a.asset, a])).values()].slice(0, n);

  const lines = [];
  lines.push(`# 📡 mesh signal digest — ${new Date().toISOString().slice(0, 10)}`);
  if (regime) lines.push(`\n**Market posture:** ${regime}`);
  if (exploit.length) { lines.push(`\n## 🚨 TVL-drain early-warning (${exploit.length})`); uniq(exploit, 5).forEach(a => lines.push(`- ${a.msg}`)); }
  if (depeg.length) { lines.push(`\n## 🩹 Stablecoin depegs (${depeg.length})`); uniq(depeg, 5).forEach(a => lines.push(`- ${a.msg}`)); }
  if (yield_.length) { lines.push(`\n## 🌾 Top real yields (base, ≤500% sane band)`); uniq(yield_, 5).forEach(a => lines.push(`- ${a.msg}`)); }
  if (funding.length) { lines.push(`\n## 📉 Funding extremes (crowded positioning)`); uniq(funding, 6).forEach(a => lines.push(`- ${a.msg}`)); }
  lines.push(`\n_Keyless · free tier. Realtime push + pro signals: github.com/sstiempro/mesh_`);
  const markdown = lines.join('\n');

  // thread chunks for X/Farcaster (≤270 chars each)
  const thread = [];
  let head = `📡 crypto signal digest ${new Date().toISOString().slice(5, 10)}${regime ? ` — ${regime}` : ''}`;
  thread.push(head);
  if (exploit.length) thread.push(`🚨 TVL-drain watch:\n` + uniq(exploit, 3).map(a => '• ' + a.msg).join('\n').slice(0, 250));
  if (yield_.length) thread.push(`🌾 real yields today:\n` + uniq(yield_, 3).map(a => '• ' + a.msg).join('\n').slice(0, 250));
  if (depeg.length || funding.length) thread.push([...uniq(depeg, 2), ...uniq(funding, 2)].map(a => '• ' + a.msg).join('\n').slice(0, 250));

  try { await writeFile(DIGEST, markdown); } catch {}
  return { generated: new Date().toISOString(), window: '24h', counts: { exploit: exploit.length, depeg: depeg.length, yields: yield_.length, funding: funding.length }, regime, markdown, thread,
    note: 'Ready-to-post. Grab data/digest-latest.md or POST the thread chunks. Auto-regenerated each tick.' };
}

// operator resolves a card from the dashboard: mark it done/dismissed (append-only status update)
export async function resolveAction(sig, status) {
  if (!sig || !['done', 'dismissed', 'pending'].includes(status)) return { ok: false, error: 'need sig + status(done|dismissed)' };
  await appendFile(QUEUE, JSON.stringify({ sig, status, ts: new Date().toISOString() }) + '\n');
  return { ok: true, sig, status };
}
