#!/usr/bin/env node
// Opportunity scanner. Periodic snapshot of the live keyless yield + arb scanners → data/opportunities.jsonl
// (append-only). This is "forward-is-backward for yield": each pass records WHICH pools are in the top list
// and the best safe yield / best arb right now. yields() reads these snapshots back to compute PERSISTENCE —
// a number seen once is noise, a number that holds for many snapshots is real. The scanner only RECORDS;
// the operator signs every deposit. Source = the dashboard's own /api/* (single source of truth). launchd-run.
import { readFile, appendFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(LAB, 'data');
const OUT = path.join(DATA, 'opportunities.jsonl');
const DASH = process.env.DASH || 'http://127.0.0.1:8787';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const getj = async (p) => { try { return await (await fetch(`${DASH}${p}`, { signal: AbortSignal.timeout(15000) })).json(); } catch { return null; } };

async function interval() {
  try { const c = JSON.parse(await readFile(path.join(LAB, 'config', 'opportunity-config.json'), 'utf8')); return +c.refresh_yields_sec || 180; }
  catch { return 180; }
}

async function snapshot() {
  const [y, s, pulse] = await Promise.all([ getj('/api/yields'), getj('/api/spreads'), getj('/api/world-pulse') ]);
  if (!y || !y.top) { log('yields unavailable, skip'); return; }
  const top = (y.top || []).slice(0, 30);
  const base = (y.base || [])[0] || null;
  const arbAll = [...((s && s.cross) || []), ...((s && s.triangular) || [])].sort((a, b) => b.net_bps - a.net_bps);
  const bestArb = arbAll[0] || null;
  const row = {
    ts: Date.now(), date: new Date().toISOString().slice(0, 10),
    top_pools: top.map(p => p.pool),                       // ids → persistence counting
    base_best: base ? { project: base.project, symbol: base.symbol, chain: base.chain, apy: base.apy, organic: base.organic } : null,
    top_apy: top[0] ? top[0].apy : null,
    arb_best_net_bps: bestArb ? bestArb.net_bps : null,
    arb_profitable: !!(s && s.any_profitable),
    fng: pulse ? pulse.fng : null, regime: pulse ? pulse.regime : null,   // world-pulse over time → did fear/greed timing pay?
  };
  await mkdir(DATA, { recursive: true });
  await appendFile(OUT, JSON.stringify(row) + '\n');
  log(`snap: ${top.length} pools · base ${row.base_best ? `${row.base_best.project} ${row.base_best.apy}%` : '—'} · best arb ${row.arb_best_net_bps}bps ${row.arb_profitable ? '⚠PROFIT' : ''}`);
}

async function loop() {
  const sec = await interval();
  log(`[opportunity-scanner] starting · every ${sec}s → ${OUT}`);
  for (;;) {
    try { await snapshot(); } catch (e) { log('snapshot error', String(e)); }
    await new Promise(r => setTimeout(r, sec * 1000));
  }
}
loop();
