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
import { orchestrate } from '../dashboard/execution.mjs';
import { runPaper } from '../dashboard/paper-engine.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = path.join(LAB, 'data', 'build-queue.jsonl');
const LEDGER = path.join(LAB, 'data', 'build-ledger.jsonl');
const FEED = path.join(LAB, 'data', 'monitor-feed.json');

const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

async function knockDown() {
  // pick the highest-scored queued 'auto' idea not yet active
  const reg = await loadRegistry();
  const active = new Set((reg.monitors || []).map(m => `${m.template}:${JSON.stringify(m.params || {})}`));
  const led = readJsonl(LEDGER);
  const built = new Set(led.filter(e => e.action === 'built').map(e => e.sig));
  const failed = {}; for (const e of led.filter(e => e.action === 'build-failed')) failed[e.sig] = (failed[e.sig] || 0) + 1;
  const cand = readJsonl(QUEUE)
    // skip already-built, already-active, and ideas that have failed verification >=3x (don't block the slot forever)
    .filter(o => o.kind === 'auto' && !built.has(o.sig) && (failed[o.sig] || 0) < 3 && !active.has(`${o.template}:${JSON.stringify(o.params || {})}`))
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
  // ORCHESTRATE: route signals → actions (auto-execute / deliver / queue-for-approval)
  let plan = null; try { plan = await orchestrate(); } catch (e) { plan = { error: String(e).slice(0, 80) }; }
  // PAPER EXECUTION: the signals actually TRADE (paper) — open/MTM/exit, tracked P&L
  let paper = null; try { paper = await runPaper(); } catch (e) { paper = { error: String(e).slice(0, 80) }; }
  const summary = { ts: new Date().toISOString(), action: 'tick', new_ideas: ideas.length,
    knocked: knock?.built || (knock?.failed ? `FAILED:${knock.failed}` : 'none'),
    monitors_live: feed.live, monitors_total: feed.count, alerting: feed.alerting,
    actions_routed: plan?.routed ?? 0, auto_executed: plan?.auto?.executed ?? 0, published: plan?.deliver?.published ?? 0, webhooks_sent: plan?.deliver?.webhooks_sent ?? 0, approve_queued: plan?.approve?.added ?? 0, confluence: plan?.confluence ?? 0 };
  await appendFile(LEDGER, JSON.stringify(summary) + '\n');
  summary.paper_equity = paper?.equity ?? null; summary.paper_open = paper?.positions?.length ?? null;
  console.log(`tick ✓  +${ideas.length} ideas · knocked: ${summary.knocked} · monitors ${feed.live}/${feed.count} · actions ${summary.actions_routed} · paper $${summary.paper_equity} (${summary.paper_open} open)`);
})();
