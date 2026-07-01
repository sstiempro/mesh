#!/usr/bin/env node
// canary.mjs — the every-pass pulse + launchpad for the cpu-miner-lab build loop.
// Chirps whether the autonomous loop is ALIVE (cron + dashboard + freshness), shows what it has
// knocked down, and surfaces the next avenue to build. Exit 0 = healthy, 1 = canary tripped.
// Run at the start of every pass:  node tools/canary.mjs
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH = process.env.DASH || 'http://127.0.0.1:8787';
const jsonl = (f) => existsSync(path.join(LAB, f)) ? readFileSync(path.join(LAB, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const launchd = (label) => { try { const o = execSync(`launchctl list 2>/dev/null | grep ${label} || true`, { encoding: 'utf8' }).trim(); return o ? o.split(/\s+/) : null; } catch { return null; } };
const get = async (p) => { try { const r = await fetch(DASH + p, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch { return null; } };

const trips = [];
if (!launchd('com.xyzmining.builder')) trips.push('builder cron NOT loaded → launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.xyzmining.builder.plist');
if (!launchd('com.xyzmining.dashboard')) trips.push('dashboard cron NOT loaded → launchctl kickstart -k "gui/$(id -u)/com.xyzmining.dashboard"');

const builder = await get('/api/builder');
if (!builder) trips.push('dashboard /api/builder unreachable → restart com.xyzmining.dashboard');

let ageMin = null;
if (builder?.last_tick?.ts) {
  ageMin = Math.round((Date.now() - new Date(builder.last_tick.ts).getTime()) / 60000);
  if (ageMin > 15) trips.push(`loop STALE — last tick ${ageMin}min ago (cron stuck? check logs/com.xyzmining.builder.err.log)`);
}

const ledger = jsonl('data/build-ledger.jsonl');
const doneSig = new Set(ledger.filter(e => e.action === 'spec-built').map(e => e.sig));
const queue = jsonl('data/build-queue.jsonl');
const pendingSpecs = queue.filter(o => o.kind === 'spec' && !doneSig.has(o.sig)).sort((a, b) => (b.score || 0) - (a.score || 0));
const monitors = await get('/api/monitors');
const exec = await get('/api/execution');
const paper = await get('/api/paper');
const creds = await get('/api/credentials');

console.log('🐤 CANARY — cpu-miner-lab build pass\n');
console.log(trips.length ? '⚠️  TRIPPED:\n' + trips.map(t => '   - ' + t).join('\n') : '✅ healthy — the loop is alive and knocking down avenues on its own');
console.log('');
if (builder) console.log(`loop:     ${builder.monitors_active} monitors · ${builder.built_by_loop} built by loop · ${builder.ideas_generated} ideas · ${builder.ticks_run} ticks · last tick ${ageMin ?? '?'}min ago`);
if (monitors) console.log(`monitors: ${monitors.live}/${monitors.count} live · ${monitors.alerting} firing`);
if (exec) console.log(`actions:  ${exec.routed || 0} routed/tick · ${exec.deliver?.published || 0} published to /api/feed${exec.deliver?.webhooks_sent ? ` · ${exec.deliver.webhooks_sent} webhook push` : ' (pro webhook off)'} · ${exec.pending_count || 0} cards awaiting your click`);
if (paper) console.log(`paper:    $${paper.equity} equity (${paper.return_pct >= 0 ? '+' : ''}${paper.return_pct}%) · ${paper.open_positions} open · ${paper.closed_trades} closed · win ${paper.win_rate ?? '—'}% ← signals actually TRADE`);
if (creds) console.log(`vault:    ${creds.count} saved keys wired (secrets external, never in repo)`);
const hunt = (() => { try { return JSON.parse(readFileSync(path.join(LAB, 'data', 'audit-watch.json'), 'utf8')); } catch { return null; } })();
if (hunt) { const hAge = Math.round((Date.now() - new Date(hunt.ts).getTime()) / 60000); console.log(`hunt:     ${hunt.watched} repos watched · ${hunt.audited} audited · ${hunt.total_high} high leads · ${hunt.new_high_cards} new cards · ${hAge}min ago ← audit-watch (bug-bounty loop)`); }
const spentSpecs = ledger.filter(e => e.action === 'spec-built').length;
console.log(`specs:    ${pendingSpecs.length} pending · ${spentSpecs} already built\n`);
console.log(`🎯 NEXT TO KNOCK DOWN (highest-scored pending specs):`);
if (pendingSpecs.length) pendingSpecs.slice(0, 6).forEach((s, i) => console.log(`   ${i + 1}. [${s.score}] ${s.idea}   ⟵ ${s.from}`));
else console.log('   queue thin — add a NEW monitor TEMPLATE to dashboard/monitors.mjs + a param row to tools/idea-gen.mjs (the loop will mass-produce variants).');

const cards = exec?.pending_actions || [];
if (cards.length) {
  console.log(`\n💳 ACTION CARDS awaiting the operator (real-money/identity — he clicks):`);
  cards.slice(0, 5).forEach((c, i) => console.log(`   ${i + 1}. [${c.type}] ${(c.action || c.msg || '').slice(0, 72)}${c.needs ? '  · needs ' + c.needs : ''}`));
}

console.log('\n--- machine ---');
console.log(JSON.stringify({ healthy: !trips.length, trips, ageMin, monitors_active: builder?.monitors_active ?? null, monitors_live: monitors?.live ?? null, pending_specs: pendingSpecs.length, next: pendingSpecs[0] || null, action_cards: cards.length }));
process.exit(trips.length ? 1 : 0);
