// monitors.mjs — keyless monitor ENGINE. Each monitor = a real data product: public source →
// compute → a signal/alert feed you can sell (open-core) or trade off. Self-contained (own fetch),
// so the builder cron can run it without booting the http server. $0, no keys, paper-safe.
//
// A monitor SPEC: { id, template, label, params, monetize }. runMonitor(spec) → { id, ok, level, signal, alerts[], ts }.
// State that needs history (TVL baselines, last sentiment) lives in config/monitor-state.json.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(LAB, 'config', 'monitor-state.json');
export const REGISTRY = path.join(LAB, 'config', 'monitors.json');

async function gjT(u, ms = 9000) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'mesh-monitor' } }); return await r.json(); }
  catch { return null; }
}
async function loadState() { try { return JSON.parse(await readFile(STATE, 'utf8')); } catch { return {}; } }
async function saveState(s) { try { await writeFile(STATE, JSON.stringify(s, null, 2)); } catch {} }

// ── monitor templates: keyless source → signal ──────────────────────────────
export const TEMPLATES = {
  // Stablecoin depeg watch — coingecko spot vs $1.00
  'stable-depeg': async (p) => {
    const ids = p.ids || 'tether,usd-coin,dai,first-digital-usd,paypal-usd,frax';
    const j = await gjT(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    if (!j) return { ok: false };
    const thr = p.threshold ?? 0.005;
    const alerts = [];
    for (const [id, v] of Object.entries(j)) {
      const px = v.usd, dev = px - 1;
      if (Math.abs(dev) >= thr) alerts.push({ id, price: px, deviation: +(dev * 100).toFixed(3) + '%', side: dev < 0 ? 'discount' : 'premium' });
    }
    return { ok: true, level: alerts.length ? 'alert' : 'ok', signal: `${Object.keys(j).length} stables checked`, alerts };
  },
  // Protocol TVL drain — sudden drop vs stored baseline = possible exploit / mass-exit (early warning)
  'tvl-drain': async (p, st) => {
    const j = await gjT('https://api.llama.fi/protocols', 12000);
    if (!Array.isArray(j)) return { ok: false };
    const cat = p.category || null, minTvl = p.minTvl ?? 5e7, dropPct = p.dropPct ?? 0.15;
    const now = {}, alerts = [];
    const pool = j.filter(x => x.tvl > minTvl && (!cat || x.category === cat));
    const key = `tvl_${cat || 'all'}`;
    const base = (st[key] || {});
    for (const x of pool) {
      now[x.name] = x.tvl;
      const prev = base[x.name];
      if (prev && x.tvl < prev * (1 - dropPct)) {
        alerts.push({ name: x.name, category: x.category, drop: +((1 - x.tvl / prev) * 100).toFixed(1) + '%', tvl: Math.round(x.tvl), was: Math.round(prev) });
      }
    }
    st[key] = now; // roll baseline
    return { ok: true, level: alerts.length ? 'alert' : 'ok', signal: `${pool.length} protocols watched${base && Object.keys(base).length ? '' : ' (baseline seeded)'}`, alerts, _persist: true };
  },
  // Funding-rate extremes — Binance perps; |funding| extreme = crowded positioning (mean-revert / harvest)
  'funding-extreme': async (p) => {
    const j = await gjT('https://fapi.binance.com/fapi/v1/premiumIndex', 9000);
    if (!Array.isArray(j)) return { ok: false };
    const thr = p.threshold ?? 0.0008; // 0.08%/8h
    const rated = j.filter(x => x.symbol.endsWith('USDT')).map(x => ({ symbol: x.symbol.replace('USDT', ''), funding: +x.lastFundingRate }))
      .filter(x => Number.isFinite(x.funding));
    const alerts = rated.filter(x => Math.abs(x.funding) >= thr)
      .sort((a, b) => Math.abs(b.funding) - Math.abs(a.funding))
      .slice(0, 12).map(x => ({ symbol: x.symbol, funding: +(x.funding * 100).toFixed(4) + '%', side: x.funding > 0 ? 'longs pay (fade longs)' : 'shorts pay (fade shorts)' }));
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${rated.length} perps, ${alerts.length} extreme`, alerts };
  },
  // High-APY stable-pool radar — DefiLlama yields; new real yield from $0 (post your own capital later)
  'yield-spike': async (p) => {
    const j = await gjT('https://yields.llama.fi/pools', 12000);
    const data = j?.data; if (!Array.isArray(data)) return { ok: false };
    const minApy = p.minApy ?? 20, minTvl = p.minTvl ?? 1e6, stableOnly = p.stableOnly ?? true;
    const alerts = data.filter(x => x.apy >= minApy && x.tvlUsd >= minTvl && (!stableOnly || x.stablecoin))
      .sort((a, b) => b.apy - a.apy).slice(0, 10)
      .map(x => ({ pool: `${x.project}:${x.symbol}`, apy: +x.apy.toFixed(1) + '%', tvl: Math.round(x.tvlUsd), chain: x.chain }));
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${data.length} pools, ${alerts.length} hot`, alerts };
  },
  // Gas / congestion watch — high gas = MEV/congestion window (or just "wait to transact")
  'gas-watch': async (p) => {
    const rpcs = p.rpc ? [p.rpc] : ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com', 'https://rpc.ankr.com/eth'];
    const thr = p.threshold ?? 30;
    for (const rpc of rpcs) {
      try {
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }), signal: AbortSignal.timeout(7000) });
        const j = await r.json(); if (!j?.result) continue;
        const gwei = parseInt(j.result, 16) / 1e9; if (!Number.isFinite(gwei)) continue;
        return { ok: true, level: gwei >= thr ? 'alert' : 'ok', signal: `${gwei.toFixed(2)} gwei`, alerts: gwei >= thr ? [{ chain: p.chain || 'eth', gwei: +gwei.toFixed(2), note: 'congestion/MEV window' }] : [] };
      } catch { /* try next rpc */ }
    }
    return { ok: false };
  },
  // Sentiment flip — Fear&Greed regime change / extreme crossing (contrarian trigger)
  'sentiment-flip': async (p, st) => {
    const j = await gjT('https://api.alternative.me/fng/?limit=2', 6000);
    const d = j?.data; if (!Array.isArray(d) || !d[0]) return { ok: false };
    const cur = +d[0].value, cls = d[0].value_classification;
    const last = st.fng_last;
    st.fng_last = cur;
    const alerts = [];
    if (cur <= 25) alerts.push({ value: cur, class: cls, trigger: 'extreme fear → contrarian long bias' });
    else if (cur >= 75) alerts.push({ value: cur, class: cls, trigger: 'extreme greed → de-risk / fade' });
    if (last != null && ((last < 50) !== (cur < 50))) alerts.push({ value: cur, class: cls, trigger: `regime flip ${last}→${cur}` });
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `F&G ${cur} (${cls})`, alerts, _persist: true };
  },
};

export async function runMonitor(spec) {
  const fn = TEMPLATES[spec.template];
  if (!fn) return { id: spec.id, template: spec.template, ok: false, level: 'unbuilt', signal: 'no template', alerts: [], ts: Date.now() };
  const st = await loadState();
  let res;
  try { res = await fn(spec.params || {}, st); } catch (e) { res = { ok: false, signal: String(e).slice(0, 80) }; }
  if (res?._persist) await saveState(st);
  return { id: spec.id, label: spec.label, template: spec.template, monetize: spec.monetize, ts: Date.now(),
    ok: !!res.ok, level: res.level || (res.ok ? 'ok' : 'down'), signal: res.signal || '', alerts: res.alerts || [] };
}

const SEED = path.join(LAB, 'config', 'monitors.seed.json');
export async function loadRegistry() {
  try { return JSON.parse(await readFile(REGISTRY, 'utf8')); } catch {}
  // fresh clone: live registry is gitignored (loop-grown) — fall back to the committed seed
  try { return JSON.parse(await readFile(SEED, 'utf8')); } catch {}
  return { _doc: 'Active keyless monitors. Auto-grown by the builder loop.', monitors: [] };
}
export async function runAll() {
  const reg = await loadRegistry();
  const results = [];
  for (const m of (reg.monitors || [])) results.push(await runMonitor(m));
  const alerts = results.flatMap(r => (r.alerts || []).map(a => ({ monitor: r.label || r.id, ...a })));
  return { ts: Date.now(), count: results.length, live: results.filter(r => r.ok).length, alerting: results.filter(r => (r.alerts || []).length).length, alerts, monitors: results };
}
