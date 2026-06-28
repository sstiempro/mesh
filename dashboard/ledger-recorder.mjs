#!/usr/bin/env node
// Earnings ledger recorder. Hourly snapshot of the whole operation → data/ledger.jsonl (append-only).
// Tracks CUMULATIVE mined value (pending+paid XMR × price) so daily/weekly/monthly EARNED = day-over-day
// delta — the real "what did we actually make", not just the rate estimate. Source = the dashboard's own
// /api/* (single source of truth). Persisted via launchd.
import { readFile, appendFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(LAB, 'data');
const LEDGER = path.join(DATA, 'ledger.jsonl');
const DASH = process.env.DASH || 'http://127.0.0.1:8787';
const INTERVAL = +(process.env.LEDGER_INTERVAL_SEC || 3600);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const getj = async (p) => { try { return await (await fetch(`${DASH}${p}`, { signal: AbortSignal.timeout(12000) })).json(); } catch { return null; } };

async function snapshot() {
  const [ov, inc, hl, fm] = await Promise.all([ getj('/api/overview'), getj('/api/income'), getj('/api/health'), getj('/api/farm') ]);
  const t = ov?.totals || {};
  const xmrTotal = (+t.pending_xmr || 0) + (+t.paid_xmr || 0);
  const price = +t.xmr_price || 0;
  const row = {
    ts: Date.now(), date: new Date().toISOString().slice(0, 10),
    xmr_pending: +t.pending_xmr || 0, xmr_paid: +t.paid_xmr || 0, xmr_total: +xmrTotal.toFixed(8),
    xmr_price: price, mining_earned_usd: +(xmrTotal * price).toFixed(4),
    hashrate: +t.xmr_hashrate || 0,
    rate_usd_day: +(t.fleet_usd_day ?? t.usd_per_day ?? 0),
    grc_earned_usd: +t.grc_earned_usd || 0,
    income_day: +(inc?.total_daily_usd || 0), held_usd: +(inc?.held_value_usd || 0),
    farm_active: fm ? (fm.active || 0) : null,
    mesh_score: hl?.mesh?.score ?? null, nodes_online: hl?.mesh?.nodes_online ?? null,
  };
  await mkdir(DATA, { recursive: true });
  await appendFile(LEDGER, JSON.stringify(row) + '\n');
  log(`snapshot: mined $${row.mining_earned_usd} cum · rate $${row.rate_usd_day}/d · ${row.hashrate} H/s · held $${row.held_usd}`);
  return row;
}

async function loop() {
  for (;;) {
    try { await snapshot(); } catch (e) { log('snapshot error', String(e)); }
    await new Promise(r => setTimeout(r, INTERVAL * 1000));
  }
}
log(`[ledger-recorder] starting · every ${INTERVAL}s → ${LEDGER}`);
loop();
