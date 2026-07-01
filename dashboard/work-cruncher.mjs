// work-cruncher.mjs — OUR general work-unit drain. The cron pulls spec work-units off the queue every tick,
// CRUNCHES each into a concrete, staged work-packet (a runbook + routing), and retires it from the queue —
// so the backlog DRAINS instead of growing forever. This is entirely ours: our queue, our task types
// (audits, grants, content, yield, feeds), our files. No external compute network — the engine IS the worker.
//
// Division of labour (honest): a plain node cron has no model, so it cannot WRITE the audit/grant/content.
// What it CAN do — and what was missing — is drain, structure, route, and STAGE every unit so the deep
// crunch is one pick-up away. Each packet is tagged `needs`:
//   build     → a zero-money dev task (add a route/feed/gate) — buildable in a normal session
//   ai-crunch → needs model reasoning (backtest a signal, write the analysis) — an AI worker pass
//   content   → draft text (thread/brief) — auto-draftable, operator posts
//   operator  → a human identity/sign/publish step
// NOTHING here touches money. It writes markdown and a ledger line. That's it.
import { appendFile, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = path.join(LAB, 'data', 'build-queue.jsonl');
const LEDGER = path.join(LAB, 'data', 'build-ledger.jsonl');
const PACKETS = path.join(LAB, 'data', 'work-packets');

const jsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// twist keyword → concrete runbook. Each returns { needs, goal, steps[], files[], who }.
function planFor(idea) {
  const t = idea.toLowerCase();
  if (t.includes('webhook feed') || t.includes('paid webhook'))
    return { needs: 'build', goal: 'Ship this signal as an open-core feed (free digest + pro realtime webhook).',
      steps: ['Confirm the source monitor fires (dashboard/monitors.mjs) and emits an alert shape.', 'Route it through execution.mjs deliver() so it lands in the public-feed (already wired).', 'Gate a pro realtime tier behind premium.mjs (ed25519 license) → config/delivery.local.json webhook.', 'Document the endpoint + tiers in the Earn/Signals tab.'],
      files: ['dashboard/execution.mjs', 'dashboard/premium.mjs', 'dashboard/server.mjs'], who: 'build (session)' };
  if (t.includes('paper-sim') || t.includes('entry gate'))
    return { needs: 'build', goal: 'Wire this signal into the omnione paper-sim as an entry gate (cross-repo).',
      steps: ['Expose the signal on /api/feed (keyless).', 'In ~/Developer/omnione, add a gate that reads the feed and only allows entries when the signal agrees.', 'Backtest with vs without the gate on the 27M-candle store (/backtest).', 'Keep paper-only — no live execution.'],
      files: ['dashboard/execution.mjs', '~/Developer/omnione/services/strategy-engine'], who: 'ai-crunch (omnione backtest)' };
  if (t.includes('confluence'))
    return { needs: 'build', goal: 'Turn two monitors firing on one asset into a single high-conviction alert.',
      steps: ['Pick the two monitor templates to cross.', 'confluence() in execution.mjs already escalates ≥2 templates on one asset — confirm both are in the registry.', 'Tune the threshold; verify a real confluence card appears in the approve lane.'],
      files: ['dashboard/execution.mjs', 'config/monitors.json'], who: 'build (session)' };
  if (t.includes('api endpoint') || t.includes('read-only api'))
    return { needs: 'build', goal: 'Expose this monitor as a public read-only, rate-limited API endpoint.',
      steps: ['Add a GET /api/<signal> route in server.mjs reading the monitor output.', 'Add a simple per-IP rate limit.', 'Document it as a free-tier read; reserve realtime for pro.'],
      files: ['dashboard/server.mjs'], who: 'build (session)' };
  if (t.includes('thread') || t.includes('auto-posted') || t.includes('audience'))
    return { needs: 'content', goal: 'Auto-compose a daily thread from this signal (attention → audience).',
      steps: ['digest() in execution.mjs already builds ≤270-char thread chunks — wire this signal type in.', 'Draft is auto-generated each tick to data/digest-latest.md.', 'OPERATOR posts it (publishing is an operator action) to X/Farcaster/Mirror.'],
      files: ['dashboard/execution.mjs', 'data/digest-latest.md'], who: 'operator (post)' };
  if (t.includes('backtest') || t.includes('edge stat') || t.includes('candle history'))
    return { needs: 'ai-crunch', goal: 'Backtest this signal against stored candle history for a real edge stat.',
      steps: ['Define the signal as a strategy in omnione simulation-engine.', 'POST /backtest then /backtest/forward (in-sample/OOS split) on the 27M-candle store.', 'Report Deflated-Sharpe + dollars-from-$100; promote only if it survives the null gate.'],
      files: ['~/Developer/omnione/services/simulation-engine'], who: 'ai-crunch (omnione)' };
  // fallback
  return { needs: 'ai-crunch', goal: idea, steps: ['Decompose the idea into a concrete build/research step.', 'Identify the wired file to upgrade (no orphans).', 'Execute, verify, log the outcome.'],
    files: ['(determine on pickup)'], who: 'ai-crunch (session)' };
}

function packetMarkdown(item, plan) {
  return [
    `# Work packet — ${item.idea}`,
    '',
    `- **sig:** \`${item.sig}\``,
    `- **source avenue:** ${item.from || 'n/a'}`,
    `- **drafted:** ${new Date().toISOString()}`,
    `- **routing (needs):** ${plan.needs}`,
    `- **does it:** ${plan.who}`,
    `- **score:** ${item.score ?? '—'}`,
    '',
    '## Goal',
    plan.goal,
    '',
    '## Concrete steps',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Files likely involved',
    ...plan.files.map(f => `- \`${f}\``),
    '',
    '## Money gate',
    'Zero money in this packet. Any deposit/claim/post is staged as a card you click, never auto-executed.',
    '',
    '---',
    '_Staged by the work-cruncher (cron drains + structures; an AI worker or you execute the crunch)._',
    '',
  ].join('\n');
}

// drainSpecs — pull the top-N undrafted spec units, crunch each into a staged packet, retire it.
// Returns { drained, remaining, packets[] }.
export async function drainSpecs({ n = 3, scoreFloor = 0 } = {}) {
  const q = jsonl(QUEUE);
  const led = jsonl(LEDGER);
  const drafted = new Set(led.filter(e => e.action === 'spec-drafted').map(e => e.sig));
  const specs = q.filter(o => o.kind === 'spec' && o.sig && !drafted.has(o.sig));
  const undrafted = specs.filter(o => (o.score || 0) >= scoreFloor).sort((a, b) => (b.score || 0) - (a.score || 0));
  const batch = undrafted.slice(0, n);
  if (!batch.length) return { drained: 0, remaining: specs.length, packets: [] };
  if (!existsSync(PACKETS)) await mkdir(PACKETS, { recursive: true });
  const packets = [];
  for (const item of batch) {
    const plan = planFor(item.idea || '');
    const file = path.join(PACKETS, `${slug(item.sig)}.md`);
    await writeFile(file, packetMarkdown(item, plan));
    await appendFile(LEDGER, JSON.stringify({ ts: new Date().toISOString(), action: 'spec-drafted', sig: item.sig, idea: item.idea, needs: plan.needs, who: plan.who, packet: path.relative(LAB, file) }) + '\n');
    packets.push({ sig: item.sig, idea: item.idea, needs: plan.needs, packet: path.relative(LAB, file) });
  }
  return { drained: packets.length, remaining: specs.length - packets.length, packets };
}

// rotateJsonl — bound an append-only file to the last keepRows lines; overflow moves to <file>.archive.jsonl.
// Use only on RECORDER files (signal-tape, opportunities) — NOT on build-ledger/build-queue, which feed dedup.
export async function rotateJsonl(file, keepRows = 5000) {
  if (!existsSync(file)) return { rotated: 0 };
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= keepRows) return { rotated: 0, rows: lines.length };
  const overflow = lines.slice(0, lines.length - keepRows);
  const keep = lines.slice(lines.length - keepRows);
  await appendFile(file + '.archive.jsonl', overflow.join('\n') + '\n');
  await writeFile(file, keep.join('\n') + '\n');
  return { rotated: overflow.length, rows: keep.length };
}

// summary for the dashboard — what the drain has produced (read by /api/command).
export function workPacketSummary() {
  const led = jsonl(LEDGER);
  const drafted = led.filter(e => e.action === 'spec-drafted');
  const q = jsonl(QUEUE);
  const draftedSigs = new Set(drafted.map(e => e.sig));
  const specsTotal = new Set(q.filter(o => o.kind === 'spec' && o.sig).map(o => o.sig)).size;
  const byNeed = {};
  for (const d of drafted) byNeed[d.needs || 'unknown'] = (byNeed[d.needs || 'unknown'] || 0) + 1;
  return { specs_total: specsTotal, drafted: draftedSigs.size, remaining: Math.max(0, specsTotal - draftedSigs.size), by_need: byNeed,
    recent: drafted.slice(-8).reverse().map(d => ({ idea: d.idea, needs: d.needs, who: d.who, packet: d.packet, ts: d.ts })) };
}

// standalone: `node dashboard/work-cruncher.mjs` drains a batch now.
if (import.meta.url === `file://${process.argv[1]}`) {
  drainSpecs({ n: Number(process.argv[2]) || 5 }).then(r => console.log(`drained ${r.drained} spec units → ${r.remaining} remaining`, r.packets.map(p => `[${p.needs}] ${p.idea.slice(0, 50)}`)));
}
