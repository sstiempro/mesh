#!/usr/bin/env node
// canary-tick.mjs — cron wrapper for canary.mjs (was real, working code, wired to nothing — nobody ever
// ran it except by hand). Runs the health check on a schedule, persists the result to
// data/canary-latest.json so the dashboard can surface it without a human running the CLI, and — if
// tripped — cards it into the same approve-queue everything else uses, deduped by trip signature so a
// standing problem doesn't spam a new card every 10 minutes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(LAB, 'data', 'canary-latest.json');
const QUEUE = path.join(LAB, 'data', 'action-queue.jsonl');

function run() {
  try {
    const out = execFileSync('/Users/digitaloutbreak/.local/bin/node', [path.join(LAB, 'tools', 'canary.mjs')], { encoding: 'utf8', timeout: 20000 });
    return { exitCode: 0, out };
  } catch (e) {
    // canary.mjs exits 1 when tripped — execFileSync throws on non-zero exit but still gives us stdout
    return { exitCode: e.status ?? 1, out: e.stdout || '' };
  }
}

function pendingSigs() {
  if (!existsSync(QUEUE)) return new Set();
  const bySig = new Map();
  for (const ln of readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean)) {
    try { const e = JSON.parse(ln); if (e.sig) bySig.set(e.sig, { ...(bySig.get(e.sig) || {}), ...e }); } catch {}
  }
  return new Set([...bySig.values()].filter((e) => e.status === 'pending').map((e) => e.sig));
}

const { exitCode, out } = run();
const lastLine = out.trim().split('\n').filter(Boolean).pop() || '{}';
let machine = {};
try { machine = JSON.parse(lastLine); } catch { machine = { healthy: exitCode === 0, trips: ['canary output unparseable'] }; }

writeFileSync(OUT, JSON.stringify({ ts: Date.now(), exitCode, ...machine }, null, 2));

if (!machine.healthy && (machine.trips || []).length) {
  const sig = `canary-trip:${machine.trips.slice().sort().join('|').slice(0, 80)}`;
  const pending = pendingSigs();
  if (!pending.has(sig)) {
    appendFileSync(QUEUE, JSON.stringify({
      lane: 'deliver', type: 'canary-trip', asset: 'system', priority: 'high',
      action: `Canary tripped: ${machine.trips[0]}${machine.trips.length > 1 ? ` (+${machine.trips.length - 1} more)` : ''}`,
      why: 'infrastructure health check failed', sig, status: 'pending', queued: new Date().toISOString(),
    }) + '\n');
    console.log('canary tripped, carded:', machine.trips);
  }
}
console.log(`canary-tick: ${machine.healthy ? 'healthy' : 'TRIPPED'} (${(machine.trips || []).length} trips)`);
