// monitors.mjs — keyless monitor ENGINE. Each monitor = a real data product: public source →
// compute → a signal/alert feed you can sell (open-core) or trade off. Self-contained (own fetch),
// so the builder cron can run it without booting the http server. $0, no keys, paper-safe.
//
// A monitor SPEC: { id, template, label, params, monetize }. runMonitor(spec) → { id, ok, level, signal, alerts[], ts }.
// State that needs history (TVL baselines, last sentiment) lives in config/monitor-state.json.
import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeneratedMonitor } from './monitor-forge.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(LAB, 'config', 'monitor-state.json');
export const REGISTRY = path.join(LAB, 'config', 'monitors.json');
const REGISTRY_LOCK = path.join(LAB, 'config', '.monitors.lock');

// config/monitors.json is read-modified-written by more than one writer (the 5-min builder cron's
// knockDown(), and monitor-forge.mjs's forgeMonitor()) with no coordination — confirmed live: a forge run
// that landed mid-tick silently vanished because a concurrent knockDown() write overwrote it. mkdir is
// atomic on POSIX (fails if the dir already exists), so it works as a simple cross-process lock with no
// new dependency. Contention should be rare (writers are minutes apart) so a short retry loop is enough.
export async function withRegistryLock(mutate, { retries = 30, delayMs = 200 } = {}) {
  let acquired = false;
  for (let i = 0; i < retries; i++) {
    try { mkdirSync(REGISTRY_LOCK); acquired = true; break; }
    catch { await new Promise((r) => setTimeout(r, delayMs)); }
  }
  if (!acquired) throw new Error('could not acquire config/monitors.json lock — a concurrent writer held it too long');
  try {
    const reg = await loadRegistry();
    reg.monitors = reg.monitors || [];
    const result = await mutate(reg);
    await writeFile(REGISTRY, JSON.stringify(reg, null, 2));
    return result;
  } finally {
    try { rmSync(REGISTRY_LOCK, { recursive: true, force: true }); } catch {}
  }
}

async function gjT(u, ms = 9000) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'mesh-monitor' } }); return await r.json(); }
  catch { return null; }
}
async function evmRpc(url, method, params, ms = 7000) {
  try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(ms) }); const j = await r.json(); return j.result; }
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
  // Funding-rate extremes — perps; |funding| extreme = crowded positioning (mean-revert / harvest).
  // Hyperliquid PRIMARY (keyless, decentralized, NOT geo-blocked); Binance fapi fallback (403 on some nets).
  'funding-extreme': async (p) => {
    const thr = p.threshold ?? 0.0008; // 0.08%/8h-equivalent
    let rated = null, src = null;
    try {
      const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }), signal: AbortSignal.timeout(9000) });
      const j = await r.json();
      if (Array.isArray(j) && j[0]?.universe && Array.isArray(j[1])) {
        rated = j[0].universe.map((u, i) => ({ symbol: u.name, funding: +j[1][i]?.funding * 8 })); src = 'HL'; // HL funding is hourly → ×8 for 8h-equiv
      }
    } catch {}
    if (!rated) { const b = await gjT('https://fapi.binance.com/fapi/v1/premiumIndex', 9000); if (Array.isArray(b)) { rated = b.filter(x => x.symbol.endsWith('USDT')).map(x => ({ symbol: x.symbol.replace('USDT', ''), funding: +x.lastFundingRate })); src = 'BIN'; } }
    if (!rated) return { ok: false };
    rated = rated.filter(x => Number.isFinite(x.funding));
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
    const maxApy = p.maxApy ?? 500; // SANITY: APY above this is almost always transient reward-token inflation, not real yield
    const alerts = data.filter(x => x.apy >= minApy && x.apy <= maxApy && x.tvlUsd >= minTvl && (!stableOnly || x.stablecoin))
      .map(x => {
        const base = x.apyBase ?? null, reward = x.apyReward ?? null;
        const rewardShare = (base != null && reward != null && x.apy > 0) ? +(reward / x.apy).toFixed(2) : null;
        // risk: real yield (mostly base, no IL) = low; incentive-driven or IL = higher
        const risk = x.ilRisk === 'yes' ? 'high (IL)' : (rewardShare != null && rewardShare > 0.7) ? 'high (incentive)' : (rewardShare != null && rewardShare > 0.4) ? 'med' : 'low (base yield)';
        return { pool: `${x.project}:${x.symbol}`, apy: +x.apy.toFixed(1) + '%', base: base != null ? +base.toFixed(1) + '%' : '?', risk, tvl: Math.round(x.tvlUsd), chain: x.chain, _base: base ?? x.apy };
      })
      // rank by REAL (base) yield first — surfaces durable yield over incentive mirages
      .sort((a, b) => (b._base) - (a._base)).slice(0, 10).map(({ _base, ...x }) => x);
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${data.length} pools, ${alerts.length} hot (≤${maxApy}% sane band)`, alerts };
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
  // Audit-contest launch watch — the bounty leg, operationalized. Polls the public contest boards
  // (Sherlock/Code4rena/Cantina, all keyless JSON) and alerts the moment a FRESH contest opens for
  // submissions, so the proven audit pipeline runs on day-1 code (least-swarmed = best odds) instead
  // of grinding swarmed/closed targets. CodeHawks needs an API key → skipped. New-contest dedup via state.
  'audit-contest-watch': async (p, st) => {
    const now = Date.now();
    const live = [];
    const seen = new Set(st.audit_seen || []);
    // ── Sherlock ──
    try {
      const j = await gjT('https://mainnet-contest.sherlock.xyz/contests', 11000);
      for (const i of (j?.items || [])) {
        const active = String(i.status || '').toUpperCase() === 'RUNNING' && (i.ends_at || 0) * 1000 > now;
        if (active) live.push({ board: 'sherlock', id: `sh:${i.id}`, title: i.title, prize: i.prize_pool ? `$${i.prize_pool.toLocaleString()}` : '?', ends: i.ends_at ? new Date(i.ends_at * 1000).toISOString().slice(0, 10) : '?', url: `https://audits.sherlock.xyz/contests/${i.id}` });
      }
    } catch {}
    // ── Code4rena ──
    try {
      const j = await gjT('https://code4rena.com/api/v1/audits', 11000);
      for (const a of (j?.data?.audits || [])) {
        const s = String(a.status || '');
        const start = Date.parse(a.startTime) || 0, end = Date.parse(a.endTime) || 0;
        const active = !/complete|judg|report/i.test(s) && start <= now && end > now;
        if (active) live.push({ board: 'code4rena', id: `c4:${a.slug || a.contestId}`, title: a.title, prize: a.formattedAmount || '?', ends: a.endTime ? a.endTime.slice(0, 10) : '?', url: `https://code4rena.com/audits/${a.slug || ''}`, public: a.codeAccess === 'public' });
      }
    } catch {}
    // ── Cantina ──
    try {
      const j = await gjT('https://cantina.xyz/api/v0/competitions', 11000);
      const arr = Array.isArray(j) ? j : (j?.competitions || []);
      for (const x of arr) {
        const active = /active|open|live|running|ongoing/i.test(String(x.status || ''));
        if (active) live.push({ board: 'cantina', id: `ca:${x.id}`, title: x.name, prize: x.totalRewardPot ? `${x.totalRewardPot} ${x.currencyCode || ''}`.trim() : '?', ends: '?', url: x.url || `https://cantina.xyz/competitions/${x.id}` });
      }
    } catch {}
    const fresh = live.filter(c => !seen.has(c.id));
    st.audit_seen = [...new Set([...(st.audit_seen || []), ...live.map(c => c.id)])].slice(-200); // bound
    // alert on NEW live contests (the actionable event: run the pipeline); tag freshness
    const alerts = live.map(c => ({ ...c, isNew: !seen.has(c.id), action: c.isNew ? 'RUN AUDIT PIPELINE (day-1 code)' : 'live' }));
    return { ok: true, level: fresh.length ? 'alert' : 'ok', signal: `${live.length} live contest(s)${fresh.length ? `, ${fresh.length} NEW` : ' (none new)'} across sherlock/c4/cantina`, alerts, _persist: true };
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
  // Stablecoin supply flow — mint/burn of major stables = aggregate capital INTO/OUT of crypto (risk-on/off).
  // Keyless DefiLlama stablecoins API ships its own prevDay/prevWeek → no state needed. (DefiLlama /emissions
  // and /raises went paid 2026 — this one is still free.)
  'stablecoin-flow': async (p) => {
    const j = await gjT('https://stablecoins.llama.fi/stablecoins?includePrices=true', 12000);
    const arr = j?.peggedAssets; if (!Array.isArray(arr)) return { ok: false };
    const minSupply = p.minSupply ?? 1e8, dayThr = p.dayThr ?? 0.02; // 2% daily supply move = notable flow
    const alerts = [];
    for (const a of arr) {
      const cur = a.circulating?.peggedUSD, prevD = a.circulatingPrevDay?.peggedUSD, prevW = a.circulatingPrevWeek?.peggedUSD;
      if (!cur || !prevD || cur < minSupply) continue;
      const dDay = (cur - prevD) / prevD;
      if (Math.abs(dDay) >= dayThr) {
        const dWeek = prevW ? (cur - prevW) / prevW : null;
        alerts.push({ symbol: a.symbol, supply: Math.round(cur), dayChange: +(dDay * 100).toFixed(2) + '%', weekChange: dWeek != null ? +(dWeek * 100).toFixed(2) + '%' : '?', flow: dDay > 0 ? 'MINT → inflow / risk-on' : 'BURN → outflow / risk-off' });
      }
    }
    alerts.sort((a, b) => Math.abs(parseFloat(b.dayChange)) - Math.abs(parseFloat(a.dayChange)));
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${arr.length} stables, ${alerts.length} with ≥${dayThr * 100}% daily supply move`, alerts: alerts.slice(0, 12) };
  },
  // World-pulse — Polymarket prediction-market odds (keyless gamma API) = the crowd's real-money read on
  // crypto + macro events. Surfaces big odds SHIFTS (state-tracked) on high-volume crypto markets: the
  // "world song" regime input. Operator thesis: prediction markets = the macro pulse fused into the feed.
  'world-pulse': async (p, st) => {
    const tag = p.tag ?? 21; // 21 = Crypto on Polymarket
    const j = await gjT(`https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=40&order=volume24hr&ascending=false&tag_id=${tag}`, 12000);
    if (!Array.isArray(j)) return { ok: false };
    const last = st.poly_last || {}, now = {}, alerts = [];
    const moveThr = p.moveThr ?? 0.10, minVol = p.minVol ?? 5e4;
    for (const m of j) {
      let p0 = null; try { const op = JSON.parse(m.outcomePrices || '[]'); p0 = op.length ? +op[0] : null; } catch {}
      if (p0 == null) continue;
      now[m.id] = p0;
      const vol = +(m.volume24hr || 0);
      const prev = last[m.id];
      if (prev != null && Math.abs(p0 - prev) >= moveThr && vol >= minVol) {
        const mv = p0 - prev;
        alerts.push({ q: (m.question || '').slice(0, 90), prob: +(p0 * 100).toFixed(0) + '%', moved: (mv > 0 ? '+' : '') + (mv * 100).toFixed(0) + 'pts', vol24h: Math.round(vol), kind: 'odds shift → regime input' });
      }
    }
    st.poly_last = now;
    alerts.sort((a, b) => b.vol24h - a.vol24h);
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${j.length} live crypto markets tracked (world pulse)${Object.keys(last).length ? '' : ' (baseline seeded)'}`, alerts: alerts.slice(0, 10), _persist: true };
  },
  // Hackathon watch — Devpost public API (keyless). Open hackathons with prize money = grant-like income +
  // builder-rep, and our autonomous build engine can actually SHIP to them. Alerts on NEW relevant (AI/web3/
  // data/fintech) hackathons. Part of the "constantly look for thousands of contests/grants" engine.
  'hackathon-watch': async (p, st) => {
    const minPrize = p.minPrize ?? 10000, maxPages = p.maxPages ?? 4;
    const seen = new Set(st.hack_seen || []);
    const all = [];
    for (let pg = 1; pg <= maxPages; pg++) {
      const j = await gjT(`https://devpost.com/api/hackathons?status[]=open&page=${pg}`, 11000);
      const hs = j?.hackathons; if (!Array.isArray(hs) || !hs.length) break;
      all.push(...hs);
      if (hs.length < 9) break;
    }
    if (!all.length) return { ok: false };
    const live = [], rel = [];
    for (const h of all) {
      const prize = parseInt(String(h.prize_amount || '').replace(/<[^>]+>/g, '').replace(/[^0-9]/g, '')) || 0;
      const themes = (h.themes || []).map(t => t.name);
      const id = `dp:${h.id}`; live.push(id);
      if (prize < minPrize) continue;
      if (themes.some(t => /AI|Machine Learning|Blockchain|Crypto|Web3|Fintech|Data|Productivity/i.test(t)))
        rel.push({ title: h.title, prize: '$' + prize.toLocaleString(), url: h.url, themes: themes.slice(0, 3), isNew: !seen.has(id) });
    }
    st.hack_seen = [...new Set([...(st.hack_seen || []), ...live])].slice(-600);
    rel.sort((a, b) => parseInt(b.prize.replace(/[^0-9]/g, '')) - parseInt(a.prize.replace(/[^0-9]/g, '')));
    const fresh = rel.filter(a => a.isNew && seen.size);
    return { ok: true, level: fresh.length ? 'alert' : rel.length ? 'signal' : 'ok', signal: `${all.length} open hackathons, ${rel.length} relevant${fresh.length ? `, ${fresh.length} NEW` : ''}`, alerts: rel.slice(0, 12), _persist: true };
  },
  // Grants watch — Karma GAP indexes grant programs across every ecosystem (keyless EAS-attestation API).
  // A live directory of where to apply for funding (company/builds), + flags newly-added programs. The
  // "thousands of grants" leg: aggregators surface the long tail, growing each scan.
  'grants-watch': async (p, st) => {
    const j = await gjT('https://gapapi.karmahq.xyz/communities', 14000);
    if (!Array.isArray(j)) return { ok: false };
    const seen = new Set(st.grant_seen || []);
    const progs = [];
    for (const c of j) {
      const d = c.details?.data || c.details || {};
      const name = d.name, slug = d.slug;
      if (!name) continue;
      const id = `gap:${slug || name}`;
      progs.push({ name, url: slug ? `https://gap.karmahq.xyz/${slug}/funding` : 'https://gap.karmahq.xyz', isNew: !seen.has(id), _id: id });
    }
    st.grant_seen = [...new Set([...(st.grant_seen || []), ...progs.map(x => x._id)])].slice(-1500);
    const fresh = progs.filter(x => x.isNew && seen.size);
    const show = (seen.size ? fresh : progs).map(({ _id, ...x }) => x);
    return { ok: true, level: fresh.length ? 'alert' : 'ok', signal: `${progs.length} grant programs indexed${fresh.length ? `, ${fresh.length} NEW` : ' (directory)'}`, alerts: show.slice(0, 15), _persist: true };
  },
  // DeFi exploit feed — DefiLlama /hacks (keyless, 575+ ledger). New record vs last-seen date = a protocol
  // JUST got drained → real-time exploit early-warning (what security teams + traders pay for). State-deduped.
  'defi-hack-watch': async (p, st) => {
    const j = await gjT('https://api.llama.fi/hacks', 12000);
    if (!Array.isArray(j)) return { ok: false };
    j.sort((a, b) => (b.date || 0) - (a.date || 0));
    const lastSeen = st.hack_last_date || 0;
    const fresh = lastSeen ? j.filter(h => (h.date || 0) > lastSeen) : [];
    st.hack_last_date = j[0]?.date || lastSeen;
    const alerts = fresh.map(h => ({ name: h.name, lost: h.amount != null ? '$' + Number(h.amount).toLocaleString() : '?', date: h.date ? new Date(h.date * 1000).toISOString().slice(0, 10) : '?', chain: (h.chain || []).join(','), technique: h.technique }));
    return { ok: true, level: alerts.length ? 'alert' : 'ok', signal: `${j.length} exploits tracked${lastSeen ? `, ${fresh.length} NEW` : ' (baseline seeded)'}`, alerts: alerts.slice(0, 8), _persist: true };
  },
  // Cross-venue funding arb — Hyperliquid predictedFundings (keyless) returns Binance+Bybit+HL funding legs
  // for 230 coins in ONE call (geo-immune — reads CEX funding without hitting the geo-blocked fapi). Normalize
  // each leg to 8h-equiv, spread = delta-neutral funding-arb (long the payer, short the payee). Distinct from
  // funding-extreme (single-venue magnitude) — this is the cross-venue SPREAD.
  'funding-arb': async (p) => {
    let r = null;
    try { r = await (await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'predictedFundings' }), signal: AbortSignal.timeout(10000) })).json(); } catch {}
    if (!Array.isArray(r)) return { ok: false };
    const thr = p.threshold ?? 0.0005;
    const rows = [];
    for (const [coin, venues] of r) {
      const legs = {};
      for (const [v, d] of (venues || [])) { if (!d) continue; const fr = +d.fundingRate, ih = +d.fundingIntervalHours || 8; if (Number.isFinite(fr)) legs[v] = fr * (8 / ih); }
      const vals = Object.entries(legs);
      if (vals.length < 2) continue;
      vals.sort((a, b) => a[1] - b[1]);
      const lo = vals[0], hi = vals[vals.length - 1], spread = hi[1] - lo[1];
      if (spread >= thr) rows.push({ coin, spread8h: +(spread * 100).toFixed(4) + '%', annualized: +(spread * 3 * 365 * 100).toFixed(1) + '%', play: `long ${lo[0]} / short ${hi[0]}` });
    }
    rows.sort((a, b) => parseFloat(b.spread8h) - parseFloat(a.spread8h));
    return { ok: true, level: rows.length ? 'signal' : 'ok', signal: `${r.length} coins, ${rows.length} cross-venue funding spreads ≥${thr * 100}%/8h`, alerts: rows.slice(0, 12) };
  },
  // Governance watch — Snapshot GraphQL (keyless) active DAO proposals closing soon = pre-event alpha
  // (treasury moves, parameter changes, token actions). Surfaces proposals ending within N hours.
  'governance-watch': async (p) => {
    const q = `{proposals(first:60,where:{state:"active"},orderBy:"end",orderDirection:asc){title space{id} scores_total quorum end}}`;
    let j = null;
    try { j = await (await fetch('https://hub.snapshot.org/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(10000) })).json(); } catch {}
    const props = j?.data?.proposals; if (!Array.isArray(props)) return { ok: false };
    const now = Date.now() / 1000, soonHrs = p.soonHrs ?? 24;
    const alerts = props.filter(pr => pr.end > now && (pr.end - now) <= soonHrs * 3600)
      .map(pr => ({ space: pr.space?.id, title: (pr.title || '').slice(0, 80), closesIn: Math.round((pr.end - now) / 3600) + 'h', votes: Math.round(pr.scores_total || 0), quorumMet: pr.quorum ? (pr.scores_total >= pr.quorum) : null }));
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${props.length} active DAO proposals, ${alerts.length} closing ≤${soonHrs}h`, alerts: alerts.slice(0, 12) };
  },
  // Vol-regime — Deribit DVOL (keyless), the "crypto VIX". Classifies BTC/ETH implied-vol regime and flags
  // spikes = risk-on/off regime input + options-vol signal (orthogonal to spot/funding). Dealers/traders
  // pay for vol-regime classification.
  'vol-regime': async (p, st) => {
    const curs = p.currencies || ['BTC', 'ETH'];
    const now = Date.now(), start = now - 6 * 3600 * 1000;
    const got = await Promise.all(curs.map(cur =>
      gjT(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&start_timestamp=${start}&end_timestamp=${now}&resolution=3600`, 10000)
        .then(j => { const d = j?.result?.data; return (Array.isArray(d) && d.length) ? { cur, dvol: d[d.length - 1][4] } : null; })));
    const out = got.filter(Boolean);
    if (!out.length) return { ok: false };
    const last = st.dvol_last || {}, alerts = [];
    for (const { cur, dvol } of out) {
      const regime = dvol >= 80 ? 'EXTREME vol' : dvol >= 60 ? 'high vol (risk-off)' : dvol >= 40 ? 'normal' : 'low vol (complacency)';
      const prev = last[cur], spike = prev != null ? (dvol - prev) / prev : null;
      if (dvol >= 60 || dvol < 30 || (spike != null && Math.abs(spike) >= 0.15))
        alerts.push({ cur, dvol: +dvol.toFixed(1), regime, change: spike != null ? (spike > 0 ? '+' : '') + (spike * 100).toFixed(0) + '%' : '?' });
      last[cur] = dvol;
    }
    st.dvol_last = last;
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `DVOL ${out.map(o => o.cur + ' ' + o.dvol.toFixed(0)).join(' / ')} (crypto VIX)`, alerts, _persist: true };
  },
  // Token-unlock watch — DefiLlama emissions datasets (keyless, non-paywalled). Upcoming unlock events for a
  // watchlist of major tokens = predictable SELL PRESSURE (insiders/investors). Parallel-fetched. The #1
  // ranked product from the keyless sweep. Surfaces unlocks within the horizon, soonest first.
  'token-unlock-watch': async (p) => {
    const watch = p.watchlist || ['ether.fi', 'pendle', 'ethena', 'arbitrum', 'optimism', 'aptos', 'sui', 'starknet', 'celestia', 'jupiter', 'wormhole', 'jito', 'dydx', 'sei-network', 'pyth'];
    const horizonDays = p.horizonDays ?? 14, now = Date.now() / 1000, horizon = now + horizonDays * 86400;
    const results = await Promise.all(watch.map(proto =>
      gjT(`https://defillama-datasets.llama.fi/emissions/${proto}`, 9000).then(j => [proto, j])));
    const alerts = [];
    for (const [proto, j] of results) {
      const events = j?.metadata?.events; if (!Array.isArray(events)) continue;
      for (const e of events.filter(e => e.timestamp > now && e.timestamp <= horizon)) {
        const tokens = Array.isArray(e.noOfTokens) ? e.noOfTokens.reduce((a, b) => a + (+b || 0), 0) : 0;
        if (tokens <= 0) continue;
        alerts.push({ token: proto, inDays: Math.round((e.timestamp - now) / 86400), tokens: Math.round(tokens), category: e.category, when: new Date(e.timestamp * 1000).toISOString().slice(0, 10) });
      }
    }
    alerts.sort((a, b) => a.inDays - b.inDays);
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${watch.length} tokens watched, ${alerts.length} unlocks ≤${horizonDays}d (sell-pressure)`, alerts: alerts.slice(0, 15) };
  },
  // Narrative rotation — CoinGecko categories + trending (keyless). Which NARRATIVE (AI/RWA/DePIN/memes/
  // ERC-404…) is rotating IN, with a volume floor to kill dead-coin pumps. Attention precedes price = the
  // sector-rotation radar. 2 calls/tick (well under rate limit).
  'narrative-rotation': async (p) => {
    const [cats, trend] = await Promise.all([
      gjT('https://api.coingecko.com/api/v3/coins/categories', 11000),
      gjT('https://api.coingecko.com/api/v3/search/trending', 9000),
    ]);
    if (!Array.isArray(cats)) return { ok: false };
    const volFloor = p.volFloor ?? 1e7, chgThr = p.chgThr ?? 8;
    const hot = cats.filter(c => (c.volume_24h || 0) >= volFloor && (c.market_cap_change_24h || 0) >= chgThr)
      .sort((a, b) => (b.market_cap_change_24h) - (a.market_cap_change_24h)).slice(0, 6)
      .map(c => ({ narrative: c.name, chg24h: +(c.market_cap_change_24h).toFixed(1) + '%', vol: Math.round((c.volume_24h) / 1e6) + 'M', kind: 'narrative rotating in' }));
    const trending = Array.isArray(trend?.coins) ? trend.coins.slice(0, 7).map(c => c.item?.symbol || c.item?.name) : [];
    return { ok: true, level: hot.length ? 'signal' : 'ok', signal: `${cats.length} narratives, ${hot.length} rotating (≥${chgThr}% & $${volFloor / 1e6}M vol) | trending: ${trending.slice(0, 5).join(', ')}`, alerts: hot };
  },
  // Prediction-market whale flow — Polymarket trade tape (keyless data-api). Large real-money tickets =
  // smart-money conviction on crypto/macro events (complements world-pulse odds with FLOW). Big bets lead odds.
  'prediction-whale': async (p) => {
    const j = await gjT('https://data-api.polymarket.com/trades?limit=100&takerOnly=true', 11000);
    if (!Array.isArray(j)) return { ok: false };
    const minNotional = p.minNotional ?? 2000, alerts = [];
    for (const t of j) {
      const sz = +t.size, px = +t.price, notional = sz * px;
      if (!Number.isFinite(notional) || notional < minNotional) continue;
      alerts.push({ side: t.side, notional: '$' + Math.round(notional).toLocaleString(), prob: +(px * 100).toFixed(0) + '%', market: (t.title || '').slice(0, 70) });
    }
    alerts.sort((a, b) => parseInt(b.notional.replace(/[^0-9]/g, '')) - parseInt(a.notional.replace(/[^0-9]/g, '')));
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${j.length} recent trades, ${alerts.length} whale tickets ≥$${minNotional}`, alerts: alerts.slice(0, 12) };
  },
  // ── fused 2nd-order signals (creative-fusion roadmap) ──
  // Depeg doctor — REVERT vs BREAK. On a depeg, cross-read supply flow (mint=issuer defending→revert,
  // burn=holders running→break) + concurrent exploit. The 2nd-derivative call a threshold ping can't make.
  'depeg-doctor': async (p) => {
    const [px, flow, hacks] = await Promise.all([
      gjT('https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin,dai,first-digital-usd,paypal-usd,frax,ethena-usde&vs_currencies=usd', 9000),
      gjT('https://stablecoins.llama.fi/stablecoins?includePrices=true', 12000),
      gjT('https://api.llama.fi/hacks', 9000),
    ]);
    if (!px) return { ok: false };
    const thr = p.threshold ?? 0.005;
    const id2sym = { tether: 'USDT', 'usd-coin': 'USDC', dai: 'DAI', 'first-digital-usd': 'FDUSD', 'paypal-usd': 'PYUSD', frax: 'FRAX', 'ethena-usde': 'USDE' };
    const flowBySym = {};
    if (flow?.peggedAssets) for (const a of flow.peggedAssets) { const cur = a.circulating?.peggedUSD, pv = a.circulatingPrevDay?.peggedUSD; if (cur && pv) flowBySym[a.symbol] = (cur - pv) / pv; }
    const recentHack = Array.isArray(hacks) && hacks.some(h => (h.date || 0) * 1000 > Date.now() - 3 * 86400e3);
    const alerts = [];
    for (const [id, v] of Object.entries(px)) {
      const dev = v.usd - 1; if (Math.abs(dev) < thr) continue;
      const sym = id2sym[id] || id.toUpperCase(), f = flowBySym[sym];
      let verdict, why;
      if (f == null) { verdict = 'UNKNOWN'; why = 'no supply data'; }
      else if (f >= 0) { verdict = 'REVERT-likely'; why = `supply minting +${(f * 100).toFixed(1)}% (issuer defending)`; }
      else if (f < -0.03) { verdict = 'BREAK-RISK'; why = `supply burning ${(f * 100).toFixed(1)}% (holders running)`; }
      else { verdict = 'WATCH'; why = `supply soft ${(f * 100).toFixed(1)}%`; }
      alerts.push({ stable: sym, price: v.usd, dev: +(dev * 100).toFixed(2) + '%', verdict, why });
    }
    return { ok: true, level: alerts.some(a => a.verdict === 'BREAK-RISK') ? 'alert' : alerts.length ? 'signal' : 'ok', signal: `${Object.keys(px).length} stables checked, ${alerts.length} off-peg${recentHack ? ' · recent hack active' : ''}`, alerts };
  },
  // Unlock-coil — a token unlocking ≤Nd while perp funding is NOT already crowded-short = uncrowded supply
  // shock (fade setup); already-short = priced-in (squeeze risk). Fuses unlock calendar + funding positioning.
  'unlock-coil': async (p) => {
    const watch = p.watchlist || ['ether.fi', 'pendle', 'ethena', 'arbitrum', 'optimism', 'aptos', 'sui', 'starknet', 'celestia', 'jupiter', 'wormhole', 'dydx', 'sei-network', 'pyth'];
    const horizon = p.horizonDays ?? 10, now = Date.now() / 1000, hz = now + horizon * 86400;
    const fund = {};
    try {
      const r = await (await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'predictedFundings' }), signal: AbortSignal.timeout(9000) })).json();
      if (Array.isArray(r)) for (const [coin, venues] of r) { const hl = (venues || []).find(v => v[0] === 'HlPerp'); if (hl && hl[1]) fund[coin.toUpperCase()] = +hl[1].fundingRate; }
    } catch {}
    const sym = { 'ether.fi': 'ETHFI', pendle: 'PENDLE', ethena: 'ENA', arbitrum: 'ARB', optimism: 'OP', aptos: 'APT', sui: 'SUI', starknet: 'STRK', celestia: 'TIA', jupiter: 'JUP', wormhole: 'W', dydx: 'DYDX', 'sei-network': 'SEI', pyth: 'PYTH' };
    const res = await Promise.all(watch.map(proto => gjT(`https://defillama-datasets.llama.fi/emissions/${proto}`, 9000).then(j => [proto, j])));
    const alerts = [];
    for (const [proto, j] of res) {
      const ev = j?.metadata?.events; if (!Array.isArray(ev)) continue;
      const next = ev.filter(e => e.timestamp > now && e.timestamp <= hz).sort((a, b) => a.timestamp - b.timestamp)[0];
      if (!next) continue;
      const tokens = Array.isArray(next.noOfTokens) ? next.noOfTokens.reduce((a, b) => a + (+b || 0), 0) : 0;
      if (tokens <= 0) continue;
      const f = fund[sym[proto]];
      let setup, why;
      if (f == null) { setup = 'UNLOCK (no funding)'; why = `${Math.round((next.timestamp - now) / 86400)}d out`; }
      else if (f >= 0) { setup = 'COIL → fade (uncrowded)'; why = `funding +${(f * 100).toFixed(3)}% complacent into unlock`; }
      else { setup = 'priced-in (squeeze risk)'; why = `funding ${(f * 100).toFixed(3)}% already short`; }
      alerts.push({ token: sym[proto] || proto, inDays: Math.round((next.timestamp - now) / 86400), tokens: Math.round(tokens), category: next.category, setup, why });
    }
    alerts.sort((a, b) => a.inDays - b.inDays);
    return { ok: true, level: alerts.some(a => /COIL/.test(a.setup)) ? 'signal' : 'ok', signal: `${watch.length} tokens, ${alerts.length} unlocking ≤${horizon}d (coil-classified)`, alerts: alerts.slice(0, 12) };
  },
  // Vol-compression — bottom-decile DVOL (ring-buffer percentile) under a dated Polymarket binary resolving
  // <72h = compressed vol + known catalyst = asymmetric breakout watch. Fuses Deribit DVOL + Polymarket dates.
  'vol-compression': async (p, st) => {
    const now = Date.now();
    const j = await gjT(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${now - 6 * 3600e3}&end_timestamp=${now}&resolution=3600`, 9000);
    const data = j?.result?.data, dvol = (Array.isArray(data) && data.length) ? data[data.length - 1][4] : null;
    if (dvol == null) return { ok: false };
    const buf = (st.dvol_buf || []).concat(dvol).slice(-200); st.dvol_buf = buf;
    const sorted = [...buf].sort((a, b) => a - b);
    const pctile = sorted.length > 10 ? sorted.filter(x => x < dvol).length / sorted.length : 0.5;
    const pm = await gjT('https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=40&order=volume24hr&ascending=false&tag_id=21', 10000);
    const soon = Array.isArray(pm) ? pm.filter(m => { const e = Date.parse(m.endDate); return e && e > now && e - now < 72 * 3600e3 && (+m.volume24hr || 0) > 5e4; }).slice(0, 5).map(m => ({ q: (m.question || '').slice(0, 70), ends: m.endDate?.slice(0, 10) })) : [];
    const compressed = pctile <= 0.10;
    const alerts = (compressed && soon.length) ? [{ trigger: 'VOL-COMPRESSION + catalyst', dvol: +dvol.toFixed(1), dvol_pctile: +(pctile * 100).toFixed(0) + '%', catalysts: soon }] : [];
    return { ok: true, level: alerts.length ? 'alert' : 'ok', signal: `BTC DVOL ${dvol.toFixed(1)} (${(pctile * 100).toFixed(0)}th pctile), ${soon.length} catalysts <72h${compressed ? ' · COMPRESSED' : ''}`, alerts, _persist: true };
  },
  // GitHub dev-velocity — active repos per narrative topic = the earliest, hardest-to-fake rung of narrative
  // ignition (precedes social + price). Keyless GitHub search, TTL-cached (60 req/hr unauth limit).
  'github-velocity': async (p, st) => {
    const ttl = (p.ttlMin ?? 50) * 60e3;
    if (st.gh_ts && Date.now() - st.gh_ts < ttl && st.gh_last) return { ok: true, level: st.gh_last.alerts?.length ? 'signal' : 'ok', signal: st.gh_last.signal + ' (cached)', alerts: st.gh_last.alerts };
    const topics = p.topics || ['defi', 'zero-knowledge', 'rwa', 'depin', 'ai-agents', 'restaking'];
    const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const out = [];
    for (const t of topics) {
      const j = await gjT(`https://api.github.com/search/repositories?q=topic:${t}+pushed:>${since}&sort=updated&per_page=1`, 8000);
      if (j && typeof j.total_count === 'number') out.push({ topic: t, active_repos_7d: j.total_count, kind: 'dev-velocity' });
      await new Promise(r => setTimeout(r, 300));
    }
    out.sort((a, b) => b.active_repos_7d - a.active_repos_7d);
    const res = { signal: `${out.length} narratives ranked by 7d dev-activity`, alerts: out };
    st.gh_ts = Date.now(); st.gh_last = res;
    return { ok: out.length > 0, level: out.length ? 'signal' : 'ok', signal: res.signal, alerts: res.alerts, _persist: true };
  },
  // Prediction-vs-perp disagreement — Polymarket implied P(up) on a coin vs perp funding lean. When the
  // betting crowd and the leveraged crowd DISAGREE, one is wrong — fade the thinner/dumber-money venue.
  // The exogenous, orthogonal-to-spot signal (perp leg is paper-only; we never place a Polymarket bet).
  'prediction-vs-perp': async (p) => {
    const pm = await gjT('https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=60&order=volume24hr&ascending=false&tag_id=21', 11000);
    if (!Array.isArray(pm)) return { ok: false };
    const fund = {};
    try {
      const r = await (await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }), signal: AbortSignal.timeout(9000) })).json();
      if (Array.isArray(r) && r[0]?.universe) r[0].universe.forEach((u, i) => { fund[u.name] = +r[1][i]?.funding * 8; });
    } catch {}
    const alerts = [];
    for (const m of pm) {
      const q = m.question || '';
      const coin = /bitcoin|btc/i.test(q) ? 'BTC' : /ethereum|eth/i.test(q) ? 'ETH' : /solana|sol/i.test(q) ? 'SOL' : null;
      if (!coin) continue;
      const up = /\b(up|above|reach|hit|higher|over|moon|bull)\b|\$1[0-9]{2,}/i.test(q), down = /\b(down|below|under|lower|bear|crash|dip)\b/i.test(q);
      if (!up && !down) continue;
      let p0 = null; try { const op = JSON.parse(m.outcomePrices || '[]'); p0 = op.length ? +op[0] : null; } catch {}
      if (p0 == null) continue;
      const pmUp = up ? p0 : 1 - p0, f = fund[coin];
      if (f == null) continue;
      const diverge = (pmUp > 0.6 && f < -0.0005) || (pmUp < 0.4 && f > 0.0005);
      if (diverge && (+m.volume24hr || 0) > 2e4) alerts.push({ coin, market: q.slice(0, 58), pm_p_up: +(pmUp * 100).toFixed(0) + '%', funding8h: +(f * 100).toFixed(4) + '%', read: pmUp > 0.5 ? 'crowd bullish / perps short → squeeze-or-crowd-wrong' : 'crowd bearish / perps long → trap' });
    }
    return { ok: true, level: alerts.length ? 'signal' : 'ok', signal: `${pm.length} markets scanned, ${alerts.length} prediction-vs-perp divergences`, alerts: alerts.slice(0, 8) };
  },
  // Governance alpha — Snapshot proposals closing soon that are MATERIAL (treasury/fee/emissions/listing)
  // AND already DECIDED (quorum-met, lopsided) = the outcome is knowable hours before execution, 99% never read it.
  'governance-alpha': async (p) => {
    const q = `{proposals(first:80,where:{state:"active"},orderBy:"end",orderDirection:asc){title space{id} scores scores_total choices end}}`;
    let j = null;
    try { j = await (await fetch('https://hub.snapshot.org/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(10000) })).json(); } catch {}
    const props = j?.data?.proposals; if (!Array.isArray(props)) return { ok: false };
    const now = Date.now() / 1000, soonHrs = p.soonHrs ?? 48;
    const material = /treasur|fund|fee|emission|mint|burn|budget|incentive|listing|buyback|token|grant|allocat|reward|deploy/i;
    const alerts = [];
    for (const pr of props) {
      if (!(pr.end > now && pr.end - now <= soonHrs * 3600)) continue;
      if (!material.test(pr.title || '')) continue;
      const sc = pr.scores || [], tot = pr.scores_total || 0;
      if (tot <= 0) continue;
      const top = Math.max(...sc), topShare = top / tot, winIdx = sc.indexOf(top);
      alerts.push({ space: pr.space?.id, title: (pr.title || '').slice(0, 66), closesIn: Math.round((pr.end - now) / 3600) + 'h', leading: (pr.choices?.[winIdx] || '?').slice(0, 24), conviction: +(topShare * 100).toFixed(0) + '%', status: topShare >= 0.7 ? 'DECIDED (outcome ~known)' : 'contested' });
    }
    alerts.sort((a, b) => parseFloat(b.conviction) - parseFloat(a.conviction));
    const decided = alerts.filter(a => /DECIDED/.test(a.status)).length;
    return { ok: true, level: decided ? 'signal' : 'ok', signal: `${props.length} active proposals, ${alerts.length} material${decided ? ` (${decided} decided)` : ''}`, alerts: alerts.slice(0, 10) };
  },
  // Airdrop-eligibility confluence — cross-references YOUR tracked wallets' real onchain activity
  // (config/wallets-watch.json, keyless RPC tx-count) against airdrop-fetcher.mjs's daily tokenless-
  // candidate discovery (data/airdrop-discovered.json). A wallet already active on a chain where a fresh
  // pre-token protocol just showed up = go interact now, before any snapshot — scoped to chains you
  // already have footprint on, not a generic "here's an airdrop" list.
  'airdrop-eligibility-confluence': async (p) => {
    const CHAIN_RPC = { eth: 'https://eth.llamarpc.com', base: 'https://mainnet.base.org', arbitrum: 'https://arb1.arbitrum.io/rpc', optimism: 'https://mainnet.optimism.io', polygon: 'https://polygon-rpc.com' };
    const CHAIN_NAME = { eth: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', optimism: 'Optimism', polygon: 'Polygon' };
    let wcfg = { wallets: [] }; try { wcfg = JSON.parse(await readFile(path.join(LAB, 'config', 'wallets-watch.json'), 'utf8')); } catch {}
    const wallets = (wcfg.wallets || []).filter(w => w.address && /^0x[0-9a-fA-F]{40}$/.test(w.address) && CHAIN_RPC[w.chain]);
    if (!wallets.length) return { ok: true, level: 'ok', signal: 'no public addresses in config/wallets-watch.json yet', alerts: [] };
    let disc = null; try { disc = JSON.parse(await readFile(path.join(LAB, 'data', 'airdrop-discovered.json'), 'utf8')); } catch {}
    const candidates = disc?.candidates || [];
    if (!candidates.length) return { ok: true, level: 'ok', signal: 'no airdrop-discovered.json yet (needs tools/airdrop-fetcher.mjs to have run)', alerts: [] };
    const byChain = {};
    for (const c of candidates) for (const chName of (c.chains || [])) (byChain[chName] ||= []).push(c);
    for (const k in byChain) byChain[k].sort((a, b) => (b.is_new - a.is_new) || (b.tvl - a.tvl));

    const alerts = [];
    for (const w of wallets) {
      const nonce = await evmRpc(CHAIN_RPC[w.chain], 'eth_getTransactionCount', [w.address, 'latest']);
      const tx = nonce != null ? parseInt(nonce, 16) : 0;
      if (!tx) continue; // not yet active on this chain — nothing to confluence against
      const hits = (byChain[CHAIN_NAME[w.chain]] || []).slice(0, 2);
      for (const h of hits) alerts.push({ wallet: w.label, chain: w.chain, tx_count: tx, protocol: h.name, category: h.category, tvl: h.tvl, url: h.url, is_new: h.is_new });
    }
    return { ok: true, level: alerts.length ? 'alert' : 'ok', signal: `${wallets.length} wallet(s) checked, ${alerts.length} eligibility×candidate matches`, alerts: alerts.slice(0, 8) };
  },
};

export async function runMonitor(spec) {
  const fn = TEMPLATES[spec.template];
  // 'gen:*' = a monitor-forge.mjs autonomously-written template — always executed sandboxed (node:vm,
  // no fs/process/require), on every run, not just at forge-time. See monitor-forge.mjs's safety model.
  if (!fn && String(spec.template || '').startsWith('gen:')) {
    let res;
    try { res = await runGeneratedMonitor(spec.template, spec.params || {}); } catch (e) { res = { ok: false, signal: String(e).slice(0, 80) }; }
    return { id: spec.id, label: spec.label, template: spec.template, monetize: spec.monetize, ts: Date.now(),
      ok: !!res.ok, level: res.level || (res.ok ? 'ok' : 'down'), signal: res.signal || '', alerts: res.alerts || [] };
  }
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
