#!/usr/bin/env node
// audit-watch.mjs — the autonomous bug-hunt loop. Sweeps a roster of in-scope public repos
// (config/audit-targets.json) on a cron. DIFF-AWARE: cheap `git ls-remote HEAD` first — only
// clones + audits a target when its code CHANGED since last pass (freshly-introduced bugs are the
// real edge; static audited code reads clean). Cards only NEW high-severity leads into the existing
// approve queue (data/action-queue.jsonl) → they surface in your /api/execution queue + the canary.
//
// Reuses audit.mjs's sweep core (auditDir) — no duplicate detector logic. Find+report only: it never
// exploits, never runs against mainnet. You confirm live scope + submit. The machine hunts 24/7.
//
// Usage:  node tools/audit-watch.mjs [--force] [--only <id>]
import { auditDir } from './audit.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = path.join(LAB, 'config', 'audit-targets.json');
const STATE = path.join(LAB, 'data', 'audit-watch-state.json');
const LEADS = path.join(LAB, 'data', 'audit-leads.jsonl');
const SUMMARY = path.join(LAB, 'data', 'audit-watch.json');
const QUEUE = path.join(LAB, 'data', 'action-queue.jsonl');
const ENV = { ...process.env, PATH: `${homedir()}/.local/bin:${homedir()}/.foundry/bin:${process.env.PATH}` };

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const jsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

// pending approve-queue sigs (so we don't re-card the same lead each pass)
function pendingSigs() {
  const bySig = new Map();
  for (const e of jsonl(QUEUE)) if (e.sig) bySig.set(e.sig, { ...(bySig.get(e.sig) || {}), ...e });
  return new Set([...bySig.values()].filter(e => e.status === 'pending').map(e => e.sig));
}

function remoteHead(repo) {
  try { return sh('git', ['ls-remote', repo, 'HEAD']).split(/\s+/)[0] || null; } catch { return null; }
}

function cardLead(t, f, queuedSigs) {
  const sig = `audit:${t.id}:${f.file}:${f.line}:${f.class || f.check}`;
  if (queuedSigs.has(sig)) return false;
  queuedSigs.add(sig);
  const card = {
    lane: 'approve', type: 'audit-lead', asset: t.id, target: t.id, program: t.program, programUrl: t.programUrl,
    action: `[${f.severity}] ${t.name} ${f.file}:${f.line} — ${(f.title || f.check).slice(0, 90)}`,
    file: f.file, line: f.line, severity: f.severity, class: f.class || f.check,
    needs: 'manual confirm + Foundry PoC', why: `${t.program} scope — find+report, you confirm live scope + submit`,
    sig, status: 'pending', queued: new Date().toISOString(),
  };
  appendFileSync(QUEUE, JSON.stringify(card) + '\n');
  return true;
}

function auditTarget(t, state, opts, queuedSigs) {
  const res = { id: t.id, name: t.name, head: null, changed: false, skipped: false, files: 0, high: 0, med: 0, low: 0, new_cards: 0 };
  const head = remoteHead(t.repo);
  res.head = head?.slice(0, 10) || null;
  const prior = state[t.id]?.head;
  if (head && prior === head && !opts.force) { res.skipped = true; return res; } // unchanged → cheap skip
  res.changed = true;

  const dir = path.join(tmpdir(), 'mesh-audit-watch', `${t.id}-${Date.now().toString(36)}`);
  mkdirSync(dir, { recursive: true });
  try {
    sh('git', ['clone', '--depth', '1', t.repo, dir]);
    const auditRoot = t.sub ? path.join(dir, t.sub) : dir;
    const { files, findings } = auditDir(existsSync(auditRoot) ? auditRoot : dir);
    res.files = files.length;
    for (const f of findings) res[f.severity] = (res[f.severity] || 0) + 1;
    // record ALL findings to the leads log (the audit trail). CARD only genuinely high-precision ones:
    // Slither HIGH-impact detectors (post noise-downgrade). Pattern hits are manual-review context that
    // already lives in the on-demand report — they must NEVER auto-ping the operator's queue (too noisy).
    for (const f of findings) appendFileSync(LEADS, JSON.stringify({ ts: new Date().toISOString(), target: t.id, head: res.head, ...f }) + '\n');
    res.leads = findings.filter(x => x.severity === 'high').length; // all high leads (for the report)
    // CARD high-precision TOOL findings (Slither + Aderyn, post noise-downgrade + in-scope filter — both
    // proven 0-high on the audited roster). Pattern hits stay report-only (never auto-card).
    for (const f of findings.filter(x => (x.source === 'slither' || x.source === 'aderyn') && x.severity === 'high')) if (cardLead(t, f, queuedSigs)) res.new_cards++;
    state[t.id] = { head, lastAudit: new Date().toISOString(), files: files.length, high: res.high };
  } catch (e) {
    res.error = String(e.message || e).split('\n')[0].slice(0, 140);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  return res;
}

(async () => {
  const argv = process.argv.slice(2);
  const opts = { force: argv.includes('--force'), only: argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null };
  const cfg = readJson(TARGETS, { targets: [] });
  let targets = cfg.targets || [];
  if (opts.only) targets = targets.filter(t => t.id === opts.only);
  if (!targets.length) { console.error('no audit targets (config/audit-targets.json)'); process.exit(1); }

  const state = readJson(STATE, {});
  const queuedSigs = pendingSigs();
  console.log(`🛡️  audit-watch — ${targets.length} in-scope repos${opts.force ? ' (force)' : ''}`);
  const results = [];
  for (const t of targets) {
    process.stdout.write(`  ${t.id} … `);
    const r = auditTarget(t, state, opts, queuedSigs);
    results.push(r);
    console.log(r.error ? `error: ${r.error}` : r.skipped ? `unchanged @${r.head} (skip)` : `${r.files} files · ${r.high}H/${r.med}M/${r.low}L${r.new_cards ? ` · +${r.new_cards} NEW high card${r.new_cards > 1 ? 's' : ''} 🔔` : ''}`);
  }
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  const total_high = results.reduce((a, r) => a + (r.high || 0), 0);
  const new_cards = results.reduce((a, r) => a + (r.new_cards || 0), 0);
  const summary = { ts: new Date().toISOString(), watched: targets.length, audited: results.filter(r => r.changed && !r.error).length, skipped: results.filter(r => r.skipped).length, errors: results.filter(r => r.error).length, total_high, new_high_cards: new_cards, targets: results };
  writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));

  console.log(`\n  ${summary.audited} audited · ${summary.skipped} unchanged · ${total_high} high leads · ${new_cards} new card${new_cards === 1 ? '' : 's'} → your queue`);
  if (new_cards) console.log('  🔔 NEW high-severity leads carded — review in /api/execution. Confirm + PoC before submitting.');
  else console.log('  no new high-severity leads — audited code reads clean (expected). The loop catches the next CHANGED contract.');
})();
