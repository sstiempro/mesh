#!/usr/bin/env node
// builder-tick.mjs — the autonomous build heartbeat (cron every 5 min). Each tick:
//   1. generate new ideas (idea-gen) → data/build-queue.jsonl
//   2. KNOCK DOWN the next auto-buildable idea → register it as a live monitor (config/monitors.json)
//   3. run the whole monitor fleet → data/monitor-feed.json (fresh signals)
//   4. log the tick → data/build-ledger.jsonl
// No human in the loop. Real builds (monitors that run now), not mocks. Spec-kind ideas wait in the
// queue for a build pass. Verifies each new monitor by running it once before marking it built.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './idea-gen.mjs';
import { runMonitor, runAll, loadRegistry, REGISTRY } from '../dashboard/monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = path.join(LAB, 'data', 'build-queue.jsonl');
const LEDGER = path.join(LAB, 'data', 'build-ledger.jsonl');
const FEED = path.join(LAB, 'data', 'monitor-feed.json');

const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

async function knockDown() {
  // pick the highest-scored queued 'auto' idea not yet active
  const reg = await loadRegistry();
  const active = new Set((reg.monitors || []).map(m => `${m.template}:${JSON.stringify(m.params || {})}`));
  const built = new Set(readJsonl(LEDGER).filter(e => e.action === 'built').map(e => e.sig));
  const cand = readJsonl(QUEUE)
    .filter(o => o.kind === 'auto' && !built.has(o.sig) && !active.has(`${o.template}:${JSON.stringify(o.params || {})}`))
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  if (!cand) return null;
  // VERIFY: run it once before committing it to the fleet
  const spec = { id: cand.id.replace('idea', 'mon'), template: cand.template, label: cand.label, params: cand.params, monetize: cand.monetize };
  const test = await runMonitor(spec);
  if (!test.ok) { await appendFile(LEDGER, JSON.stringify({ ts: new Date().toISOString(), action: 'build-failed', sig: cand.sig, label: cand.label, reason: test.signal }) + '\n'); return { failed: cand.label }; }
  reg.monitors.push(spec);
  await writeFile(REGISTRY, JSON.stringify(reg, null, 2));
  await appendFile(LEDGER, JSON.stringify({ ts: new Date().toISOString(), action: 'built', sig: cand.sig, id: spec.id, label: spec.label, template: spec.template, monetize: spec.monetize, verified: true, first_signal: test.signal }) + '\n');
  return { built: spec.label, signal: test.signal };
}

(async () => {
  const ideas = await generate({ autoN: 3, specN: 2 });
  const knock = await knockDown();
  const feed = await runAll();
  await writeFile(FEED, JSON.stringify(feed, null, 2));
  const summary = { ts: new Date().toISOString(), action: 'tick', new_ideas: ideas.length,
    knocked: knock?.built || (knock?.failed ? `FAILED:${knock.failed}` : 'none'),
    monitors_live: feed.live, monitors_total: feed.count, alerting: feed.alerting };
  await appendFile(LEDGER, JSON.stringify(summary) + '\n');
  console.log(`tick ✓  +${ideas.length} ideas · knocked: ${summary.knocked} · monitors ${feed.live}/${feed.count} live · ${feed.alerting} alerting`);
})();
