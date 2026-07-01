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
import { runMonitor, runAll, loadRegistry, withRegistryLock } from '../dashboard/monitors.mjs';
import { orchestrate, regimeClock } from '../dashboard/execution.mjs';
import { runCarry } from '../dashboard/carry.mjs';
import { runContestSniper } from '../dashboard/contest-sniper.mjs';
import { runGrantFitIfStale } from '../dashboard/grant-fit.mjs';
import { runHackathonFitIfStale } from '../dashboard/hackathon-fit.mjs';
import { runPersistenceIfStale } from '../dashboard/persistence.mjs';
import { publishFeedIfStale } from './publish-feed.mjs';
import { forgeIfStale } from '../dashboard/monitor-forge.mjs';
import { drainSpecs, rotateJsonl } from '../dashboard/work-cruncher.mjs';
import { runPaper } from '../dashboard/paper-engine.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = path.join(LAB, 'data', 'build-queue.jsonl');
const LEDGER = path.join(LAB, 'data', 'build-ledger.jsonl');
const FEED = path.join(LAB, 'data', 'monitor-feed.json');
const TAPE = path.join(LAB, 'data', 'signal-tape.jsonl');
const OPPS = path.join(LAB, 'data', 'opportunities.jsonl');

const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

async function knockDown() {
  // pick the highest-scored queued 'auto' idea not yet active (a snapshot read for candidate selection —
  // the actual write below re-reads fresh under lock, so a slightly-stale snapshot here just risks picking
  // a candidate that turns out already-active, caught again next tick — not a correctness issue)
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
  // locked: monitor-forge.mjs's forgeMonitor() writes the same registry file — an unlocked write here
  // can silently drop a concurrent forge's registration (confirmed live before this fix).
  await withRegistryLock((freshReg) => { freshReg.monitors.push(spec); });
  await appendFile(LEDGER, JSON.stringify({ ts: new Date().toISOString(), action: 'built', sig: cand.sig, id: spec.id, label: spec.label, template: spec.template, monetize: spec.monetize, verified: true, first_signal: test.signal }) + '\n');
  return { built: spec.label, signal: test.signal };
}

(async () => {
  // PRODUCER throttle: when the spec backlog is deep, stop pouring more in faster than the drain can clear.
  const backlog = readJsonl(QUEUE).filter(o => o.kind === 'spec').length;
  const specN = backlog > 120 ? 0 : backlog > 40 ? 1 : 2;
  const ideas = await generate({ autoN: 3, specN });
  const knock = await knockDown();
  // DRAIN: the general work-cruncher — pull spec work-units off the queue, stage each into a packet, retire it.
  let drain = { drained: 0, remaining: 0 }; try { drain = await drainSpecs({ n: 3 }); } catch (e) { drain = { error: String(e).slice(0, 80) }; }
  // ROTATE: bound the unbounded recorder files (NOT build-ledger/build-queue — they feed dedup).
  try { await rotateJsonl(TAPE, 5000); await rotateJsonl(OPPS, 5000); } catch {}
  // PAPER: mark-to-market + exits + entries on the forward-test book (keeps it LIVE, not frozen).
  let paper = null; try { paper = await runPaper(); } catch (e) { paper = { error: String(e).slice(0, 80) }; }
  const feed = await runAll();
  await writeFile(FEED, JSON.stringify(feed, null, 2));
  // ORCHESTRATE: route signals → actions (auto-execute / deliver / queue-for-approval)
  let plan = null; try { plan = await orchestrate(); } catch (e) { plan = { error: String(e).slice(0, 80) }; }
  // REGIME: fuse stablecoin-flow + funding + F&G into one risk-on/off state on the signal-tape (feeds the paper book)
  let regime = null; try { regime = await regimeClock(); } catch (e) { regime = { error: String(e).slice(0, 80) }; }
  // CARRY: accumulate cross-venue funding-spread history (builds persistence) · SNIPER: arm on live contests
  try { await runCarry({}); } catch {}
  try { await runContestSniper(); } catch {}
  // GRANTFIT: re-score + re-draft every 6h so newly-discovered programs actually get a draft, not just a card
  let grantfit = null; try { grantfit = await runGrantFitIfStale(6); } catch (e) { grantfit = { error: String(e).slice(0, 80) }; }
  // HACKATHONFIT: same pattern, for live hackathons — the engine that used to not exist at all
  let hackfit = null; try { hackfit = await runHackathonFitIfStale(6); } catch (e) { hackfit = { error: String(e).slice(0, 80) }; }
  // PERSISTENCE: re-score durability every 3h as opportunities.jsonl grows (was frozen forever otherwise)
  try { await runPersistenceIfStale(3); } catch {}
  // PUBLISH-FEED: keep the public static mirror (feed/) within 1h of the live /api/feed (was 3+ days stale, never called)
  try { await publishFeedIfStale(1); } catch {}
  // FORGE: the actual autonomous cruncher — discover a genuinely new opportunity category, have the LLM
  // write a real monitor for it, sandbox-verify it against live data, ship it live if it passes. At most
  // once per 12h (LLM cost + keep the loop bounded); see dashboard/monitor-forge.mjs for the safety model.
  let forge = null; try { forge = await forgeIfStale(12); } catch (e) { forge = { error: String(e).slice(0, 100) }; }
  const summary = { ts: new Date().toISOString(), action: 'tick', new_ideas: ideas.length, regime: regime?.error ? `ERR:${regime.error}` : `${regime?.state}(${regime?.confidence})`,
    knocked: knock?.built || (knock?.failed ? `FAILED:${knock.failed}` : 'none'),
    specs_drained: drain.drained || 0, specs_remaining: drain.remaining ?? 0,
    paper_open: paper?.error ? `ERR:${paper.error}` : (paper?.positions?.length ?? paper?.open ?? 0), paper_realized: paper?.realized ?? null,
    monitors_live: feed.live, monitors_total: feed.count, alerting: feed.alerting,
    actions_routed: plan?.routed ?? 0, auto_executed: plan?.auto?.executed ?? 0, published: plan?.deliver?.published ?? 0, webhooks_sent: plan?.deliver?.webhooks_sent ?? 0, approve_queued: plan?.approve?.added ?? 0, confluence: plan?.confluence ?? 0,
    grantfit: grantfit?.error ? `ERR:${grantfit.error}` : grantfit?.skipped ? `skip(${grantfit.age_h}h)` : `ran:${grantfit?.drafted ?? 0} drafted`,
    hackfit: hackfit?.error ? `ERR:${hackfit.error}` : hackfit?.skipped ? `skip(${hackfit.age_h}h)` : `ran:${hackfit?.drafted ?? 0} drafted`,
    forge: forge?.error ? `ERR:${forge.error}` : forge?.skipped ? `skip(${forge.age_h}h)` : forge?.outcome ? forge.outcome + (forge.category ? `:${forge.category}` : '') : 'n/a' };
  await appendFile(LEDGER, JSON.stringify(summary) + '\n');
  console.log(`tick ✓  +${ideas.length} ideas · knocked: ${summary.knocked} · drained ${summary.specs_drained} specs (${summary.specs_remaining} left) · paper ${summary.paper_open} open · monitors ${feed.live}/${feed.count} · actions ${summary.actions_routed} (published ${summary.published}) · regime ${summary.regime} · confluence ${summary.confluence} · grantfit ${summary.grantfit} · hackfit ${summary.hackfit} · forge ${summary.forge}`);
})();
