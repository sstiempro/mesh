// carry.mjs — creative-sweep #5: durable funding-carry sheet. Cross-venue funding spread (from funding-arb,
// Bin/Bybit/HL read via Hyperliquid = GEO-IMMUNE) + a PERSISTENCE score from accumulating history = which
// carries actually HOLD vs one-tick blips. A sheet a US/compliance-restricted desk literally cannot assemble.
// Sold as DATA — never traded (the buyer executes with their own keys).
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIST = path.join(LAB, 'data', 'carry-history.jsonl');
const OUT = path.join(LAB, 'data', 'carry-latest.json');

export async function runCarry({ window = 200 } = {}) {
  const r = await runMonitor({ template: 'funding-arb', id: 'carry', params: { threshold: 0.0003 } });
  const now = Date.now();
  const spreads = (r.alerts || []).map(a => ({ coin: a.coin, spread8h: parseFloat(a.spread8h), annualized: parseFloat(a.annualized), play: a.play }));
  try { await appendFile(HIST, JSON.stringify({ ts: now, coins: spreads.map(s => s.coin) }) + '\n'); } catch {}
  const rows = existsSync(HIST) ? readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-window) : [];
  const N = rows.length || 1;
  const cnt = {}; for (const row of rows) for (const c of (row.coins || [])) cnt[c] = (cnt[c] || 0) + 1;
  const sheet = spreads.map(s => ({ ...s, persistence: +((cnt[s.coin] || 0) / N).toFixed(2), held: cnt[s.coin] || 0, of: N }))
    .sort((a, b) => b.persistence - a.persistence || b.annualized - a.annualized);
  const out = { ts: now, snapshots: N, count: sheet.length, carries: sheet.slice(0, 15), note: 'Cross-venue funding carry (Bin/Bybit/HL via Hyperliquid = geo-immune) with persistence: higher = the spread HOLDS, not a one-tick blip. Data product; buyer executes with their own keys. Never traded by us.' };
  try { await writeFile(OUT, JSON.stringify(out, null, 2)); } catch {}
  return out;
}
export async function carryView() { try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return await runCarry({}); } }
