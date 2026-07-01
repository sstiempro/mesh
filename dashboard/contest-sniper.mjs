// contest-sniper.mjs — creative-sweep #3. When a fresh audit contest opens (audit-contest-watch, keyless),
// snipe it: record the contest so a later tick can run the pipeline on the DIFF only (day-1 / mid-contest
// changed files = lowest-duplicate-risk findings), and card it for the operator to submit.
// Latent during the current contest drought, but armed — fires the moment a board goes live.
//
// HONESTY FIX (2026-07-01): the contest boards' LIST endpoints (Sherlock/C4/Cantina) don't return a git
// clone URL — only a contest-page URL. audit-watch.mjs needs a real `repo:` to git-clone. Previously this
// wrote straight into config/audit-targets.json's `targets` array (which audit-watch.mjs blindly iterates
// and git-clones) WITHOUT a repo field — so a live snipe would silently never actually get audited; it just
// looked "armed" forever. Now: only entries with a resolved repo go into `targets` (the array that's really
// wired to auto-audit). Repo-less snipes go into `needs_repo` — a real, small, non-identity task (paste one
// URL) — and are carded as that, not as "the pipeline runs it," so nothing claims automation it doesn't have.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = path.join(LAB, 'config', 'audit-targets.json');
const OUT = path.join(LAB, 'data', 'contest-sniper.json');

// best-effort repo resolution — only C4 sometimes exposes it on the list endpoint; Sherlock/Cantina don't.
function resolveRepo(c) {
  return c.repo || c.codeRepo || c.repoUrl || null;
}

export async function runContestSniper() {
  const r = await runMonitor({ template: 'audit-contest-watch', id: 'sniper', params: {} });
  const contests = (r.alerts || []);
  let targets = { _doc: 'Audit targets. contest-active entries are sniped from live boards (repo-confirmed only).', targets: [] };
  try { if (existsSync(TARGETS)) targets = JSON.parse(readFileSync(TARGETS, 'utf8')); } catch {}
  targets.targets = targets.targets || [];
  targets.needs_repo = targets.needs_repo || [];
  let armed = 0, needsRepo = 0;
  for (const c of contests) {
    const id = c.id || `${c.board}:${c.title}`;
    const repo = resolveRepo(c);
    if (repo && !targets.targets.some(t => t.id === id)) {
      targets.targets.push({ id, name: c.title, repo, board: c.board, prize: c.prize, program: c.board, programUrl: c.url, flag: 'contest-active', sniped_at: new Date().toISOString() });
      armed++;
    } else if (!repo && !targets.needs_repo.some(t => t.id === id)) {
      targets.needs_repo.push({ id, board: c.board, title: c.title, prize: c.prize, url: c.url, sniped_at: new Date().toISOString() });
      needsRepo++;
    }
  }
  if (armed || needsRepo) { try { await writeFile(TARGETS, JSON.stringify(targets, null, 2)); } catch {} }
  const out = {
    ts: Date.now(), live_contests: contests.length, armed, needs_repo: needsRepo,
    contest_targets: targets.targets.filter(t => t.flag === 'contest-active').slice(0, 10),
    pending_repo: targets.needs_repo.slice(0, 10),
    note: contests.length
      ? (armed ? `${armed} live contest(s) with a resolved repo → auto-audit pipeline will run on the next tick.` : '') +
        (needsRepo ? `${needsRepo} live contest(s) found but the board didn't expose a git repo — paste the repo URL into config/audit-targets.json's needs_repo entry to arm the audit (one-time, no identity needed).` : '')
      : 'No live contest (drought). Armed — fires the moment a board opens (audit-contest-watch on the cron).',
  };
  try { await writeFile(OUT, JSON.stringify(out, null, 2)); } catch {}
  return out;
}
export async function contestSniperView() { try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return await runContestSniper(); } }
