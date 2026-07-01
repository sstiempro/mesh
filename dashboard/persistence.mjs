// persistence.mjs — creative-sweep #6: the durability oracle. Our accumulating opportunities.jsonl history
// (1300+ snapshots, free, un-backfillable by a competitor) answers the one thing snapshot-only feeds can't:
// "is this yield REAL or a reward-token MIRAGE?" A pool that held N/M snapshots = durable real yield; one
// that flashed once = mirage. The compounding moat — worth more every day at zero added work.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPPS = path.join(LAB, 'data', 'opportunities.jsonl');
const OUT = path.join(LAB, 'data', 'persistence-latest.json');

async function liveYields() {
  try { const r = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'mesh-monitor' } }); const j = await r.json(); const m = {}; for (const p of (j.data || [])) m[p.pool] = p; return m; }
  catch { return {}; }
}
function readSnaps(window) {
  if (!existsSync(OPPS)) return [];
  const rows = readFileSync(OPPS, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return window ? rows.slice(-window) : rows;
}

export async function runPersistence({ window = 1000 } = {}) {
  const snaps = readSnaps(window);
  const N = snaps.length;
  if (!N) return { ts: Date.now(), note: 'no history yet', durable: [], mirages: [] };
  const count = {};
  for (const r of snaps) for (const pid of (r.top_pools || [])) count[pid] = (count[pid] || 0) + 1;
  const live = await liveYields();
  const pools = Object.entries(count).map(([pid, n]) => {
    const p = live[pid] || {};
    const dur = n / N;
    const organic = (p.apyBase != null && p.apy > 0) ? p.apyBase / p.apy : null;
    const verdict = dur >= 0.5 ? 'DURABLE' : dur >= 0.15 ? 'INTERMITTENT' : 'MIRAGE';
    return { id: pid, project: p.project, symbol: p.symbol, apy: p.apy != null ? +p.apy.toFixed(1) : null, tvl: p.tvlUsd ? Math.round(p.tvlUsd) : null, chain: p.chain, snaps_held: n, of: N, durability: +dur.toFixed(2), organic_share: organic != null ? +organic.toFixed(2) : null, verdict };
  }).filter(p => p.project);
  const durable = pools.filter(p => p.verdict === 'DURABLE').sort((a, b) => b.durability - a.durability || (b.apy || 0) - (a.apy || 0));
  const mirages = pools.filter(p => p.verdict === 'MIRAGE' && (p.apy || 0) > 50).sort((a, b) => (b.apy || 0) - (a.apy || 0));
  const out = {
    ts: Date.now(), window: N, pools_tracked: pools.length, durable_count: durable.length, mirage_count: mirages.length,
    durable: durable.slice(0, 15), mirages: mirages.slice(0, 10),
    note: 'Durability from our OWN opportunities.jsonl history — un-backfillable. DURABLE = held ≥50% of snapshots (real base yield); MIRAGE = flashed <15% on >50% APY (reward-token inflation). The persistence moat.',
  };
  try { await writeFile(OUT, JSON.stringify(out, null, 2)); } catch {}
  return out;
}
export async function persistenceView() { try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return await runPersistence({}); } }
// cron entry point: persistenceView() only regenerates when the cache file is MISSING, so once written
// it was frozen forever — nothing ever called runPersistence() again even as opportunities.jsonl kept
// growing. Re-run periodically so durability scores actually reflect the accumulating history.
export async function runPersistenceIfStale(hours = 3) {
  let age = Infinity;
  try { age = Date.now() - JSON.parse(await readFile(OUT, 'utf8')).ts; } catch {}
  if (age < hours * 3600e3) return { skipped: true, age_h: +(age / 3600e3).toFixed(1) };
  return await runPersistence({});
}
// durability verdict for one pool id (the sellable /api/persistence?pool=<id> lookup)
export async function durabilityOf(poolId, window = 1000) {
  const snaps = readSnaps(window); const N = snaps.length || 1;
  let n = 0; for (const r of snaps) if ((r.top_pools || []).includes(poolId)) n++;
  const dur = n / N;
  return { pool: poolId, snaps_held: n, of: N, durability: +dur.toFixed(3), verdict: dur >= 0.5 ? 'DURABLE' : dur >= 0.15 ? 'INTERMITTENT' : 'MIRAGE' };
}
