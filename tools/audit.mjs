#!/usr/bin/env node
// audit.mjs — the one-command smart-contract audit pass. Operationalizes .claude/skills/bug-hunt:
//   resolve target → tool sweep (Slither) → high-signal pattern sweep → triage/dedupe →
//   submission-ready report (data/audit-reports/<name>.{json,md}).
//
// Usage:
//   node tools/audit.mjs <git-url|local-path> [--commit <hash>] [--sub <subdir>] [--name <label>]
//   node tools/audit.mjs --target <bounty-id>        # pull url from config/bounty-targets.json
//   node tools/audit.mjs --list                      # show in-scope bounty targets
//
// Honest by design: tool + pattern hits are LEADS, not confirmed bugs. Each needs manual
// confirmation + a Foundry PoC (skill steps 4–6) before it's submittable. Find+report only —
// never exploits, never runs against mainnet. The operator submits + signs.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(LAB, 'data', 'audit-reports');
const SLITHER = `${homedir()}/.local/bin/slither`;
const ADERYN = `${homedir()}/.cargo/bin/aderyn`;
const PATH_AUG = `${homedir()}/.local/bin:${homedir()}/.foundry/bin:${process.env.PATH}`;
const ENV = { ...process.env, PATH: PATH_AUG };

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });

// ---- in-scope .sol discovery (skip deps / tests / mocks) ----
const SKIP_DIR = /(^|\/)(node_modules|lib|out|cache|artifacts|\.git|dependencies|forge-std|openzeppelin|solmate|test|tests|mock|mocks|script)(\/|$)/i;
export function findSol(root) {
  const out = [];
  const walk = (d) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(p.slice(root.length))) walk(p); }
      else if (e.name.endsWith('.sol') && !/\.(t|test)\.sol$/i.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

// ---- tool sweep: Slither → parsed, impact-filtered findings ----
const SLITHER_DROP = new Set([ // info/opt/style noise — never a payout
  'naming-convention','solc-version','pragma','dead-code','low-level-calls','assembly','similar-names',
  'too-many-digits','external-function','unused-state','immutable-states','constable-states','costly-loop',
  'cyclomatic-complexity','unimplemented-functions','redundant-statements','boolean-equal','unused-return',
]);
const IMPACT = { High: 'high', Medium: 'medium', Low: 'low' };
// high-IMPACT but low-PRECISION on sophisticated/audited code (assembly, intentional callbacks) — keep
// them in the report but downgrade to 'low' so they don't inflate the high count or auto-card the operator.
const SLITHER_NOISE = new Set([
  'incorrect-return','return-leave','reentrancy-benign','reentrancy-events','reentrancy-no-eth',
  'calls-loop','timestamp','block-other-parameters','void-cst','tautology','redundant-statements',
]);
export function slitherSweep(root) {
  let raw;
  try {
    // --json - prints the report to stdout; non-zero exit when it finds issues, so catch + read stdout
    raw = sh(SLITHER, [root, '--json', '-', '--exclude-dependencies'], { cwd: root });
  } catch (e) {
    raw = e.stdout || '';
    if (!raw) return { ok: false, reason: (String(e.stderr || e.message).split('\n').find(Boolean) || 'slither failed').slice(0, 200), findings: [] };
  }
  let j; try { j = JSON.parse(raw); } catch { return { ok: false, reason: 'slither output unparseable (compile likely failed — check solc version / deps)', findings: [] }; }
  if (!j.success && !(j.results && j.results.detectors)) return { ok: false, reason: (j.error || 'slither did not produce results').toString().slice(0, 200), findings: [] };
  const dets = (j.results?.detectors) || [];
  const findings = [];
  for (const d of dets) {
    if (SLITHER_DROP.has(d.check)) continue;
    let sev = IMPACT[d.impact];
    if (!sev || d.confidence === 'Low') continue; // keep High/Med impact, drop low-confidence
    if (SLITHER_NOISE.has(d.check)) sev = 'low'; // precision downgrade — real but FP-prone on complex code
    const el = (d.elements || []).find(x => x.source_mapping?.filename_relative) || d.elements?.[0];
    const sm = el?.source_mapping;
    findings.push({
      source: 'slither', check: d.check, severity: sev, confidence: d.confidence,
      file: sm?.filename_relative || sm?.filename_short || '?',
      line: sm?.lines?.[0] ?? null,
      title: (d.description || d.check).split('\n')[0].slice(0, 160).trim(),
      description: (d.description || '').slice(0, 600).trim(),
    });
  }
  return { ok: true, findings };
}

// ---- tool sweep #2: Aderyn (Cyfrin) — AST analyzer with a detector set complementary to Slither ----
const ADERYN_NOISE = new Set([ // aderyn detectors that are style/info on audited code → keep but downgrade
  'centralization-risk','solmate-safetransferlib','unsafe-erc20-operation','unindexed-events','useless-public-function',
  'constants-instead-of-literals','large-literal','unspecific-solidity-pragma','zero-address-check','push-zero-opcode',
  'require-with-string','non-reentrant-not-first','unused-import','empty-block','redundant-statements',
  'reused-contract-name','contract-with-todos','useless-modifier','useless-internal-function','dead-code',
]);
export function aderynSweep(root) {
  const outFile = path.join(tmpdir(), `aderyn-${Date.now().toString(36)}.json`);
  try { sh(ADERYN, [root, '-o', outFile, '--skip-update-check'], { cwd: root }); }
  catch (e) { if (!existsSync(outFile)) return { ok: false, reason: (String(e.stderr || e.message).split('\n').find(Boolean) || 'aderyn failed').slice(0, 160), findings: [] }; }
  let j; try { j = JSON.parse(readFileSync(outFile, 'utf8')); } catch { return { ok: false, reason: 'aderyn output unparseable', findings: [] }; }
  try { rmSync(outFile, { force: true }); } catch {}
  const findings = [];
  const take = (bucket, impactSev) => {
    for (const iss of (bucket?.issues || [])) {
      const det = iss.detector_name || iss.title || 'aderyn';
      let sev = impactSev;
      if (ADERYN_NOISE.has(det)) sev = 'low';
      for (const ins of (iss.instances || []).slice(0, 40)) findings.push({
        source: 'aderyn', check: det, severity: sev,
        file: ins.contract_path || '?', line: ins.line_no ?? ins.line ?? null,
        title: (iss.title || det).slice(0, 160), description: (iss.description || '').replace(/\s+/g, ' ').slice(0, 500),
      });
    }
  };
  take(j.high_issues, 'high');
  take(j.low_issues, 'low');
  // aderyn traverses the whole repo incl mocks/interfaces/tests — apply the same in-scope filter as findSol
  return { ok: true, findings: findings.filter(f => f.file && !SKIP_DIR.test('/' + String(f.file).replace(/^\.?\/?/, ''))) };
}

// ---- pattern sweep: high-signal regexes mapped to methodology classes (LEADS, manual-confirm) ----
// each: re, class, severity (prior), why. Conservative — flags for review, never asserts a bug.
const PATTERNS = [
  { re: /\btx\.origin\b/, class: 'access-control', sev: 'high', why: 'tx.origin used in auth is phishable — confirm it gates a privileged action' },
  { re: /\bselfdestruct\s*\(/, class: 'upgrade/proxy', sev: 'high', why: 'selfdestruct — confirm caller is trust-gated; can brick a proxy/lib' },
  { re: /\bdelegatecall\s*\(/, class: 'external-call', sev: 'high', why: 'delegatecall — confirm target is not attacker-controlled (storage takeover)' },
  { re: /function\s+initialize\b[^)]*\)\s*(public|external)(?![^{]*\binitializer\b)/, class: 'access-control', sev: 'high', why: 'initialize() not guarded by initializer modifier — re-init / front-run risk' },
  { re: /\.latestAnswer\s*\(/, class: 'oracle/price', sev: 'high', why: 'latestAnswer() has no staleness/round data — use latestRoundData + check updatedAt' },
  { re: /\.latestRoundData\s*\(/, class: 'oracle/price', sev: 'medium', why: 'oracle read — confirm updatedAt / answeredInRound / min-max bounds are checked' },
  { re: /\becrecover\s*\(/, class: 'signature/replay', sev: 'medium', why: 'ecrecover — confirm nonce + deadline + chainId guard against replay/malleability' },
  { re: /\.call\{\s*value\s*:/, class: 'reentrancy', sev: 'medium', why: 'raw value call — confirm state is updated BEFORE the call (checks-effects-interactions)' },
  { re: /block\.(timestamp|number|prevrandao|difficulty)\b[^;\n]{0,40}[%\^]/, class: 'weak-randomness', sev: 'medium', why: 'block value in arithmetic/randomness — miner/validator manipulable' },
  { re: /\bblockhash\s*\(/, class: 'weak-randomness', sev: 'low', why: 'blockhash as randomness — predictable / 0 beyond 256 blocks' },
  { re: /function\s+\w*(withdraw|mint|burn|sweep|rescue|setOwner|setAdmin|upgrade)\w*\s*\([^)]*\)\s*(public|external)(?![^{]*(onlyOwner|onlyRole|require\s*\(|_checkRole|nonReentrant|auth))/i, class: 'access-control', sev: 'medium', why: 'fund/admin-moving function without an obvious access modifier — verify it is gated' },
  { re: /\bapprove\s*\([^,]+,\s*(?!0\b)/, class: 'external-call', sev: 'low', why: 'approve to non-zero without zeroing first — allowance race on some tokens' },
];
export function patternSweep(files, root) {
  const hits = [];
  for (const f of files) {
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim().startsWith('//') || ln.trim().startsWith('*')) continue; // skip comments
      for (const p of PATTERNS) {
        if (p.re.test(ln)) hits.push({
          source: 'pattern', check: p.class, severity: p.sev, class: p.class,
          file: path.relative(root, f), line: i + 1,
          title: p.why, snippet: ln.trim().slice(0, 120),
        });
      }
    }
  }
  return hits;
}

// ---- triage: merge, sort by severity, dedupe same file:line:class ----
const SEV_RANK = { high: 0, medium: 1, low: 2 };
export function triage(slither, patterns) {
  const all = [...slither, ...patterns];
  const seen = new Set(); const uniq = [];
  for (const f of all.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])) {
    const k = `${f.file}:${f.line}:${f.check || f.class}`;
    if (seen.has(k)) continue; seen.add(k); uniq.push(f);
  }
  return uniq;
}

// auditDir — the sweep core, importable (audit-watch reuses it so there's no duplicate detector logic).
export function auditDir(dir) {
  const files = findSol(dir);
  if (!files.length) return { files: [], findings: [], sweepInfo: { slither: 'no in-scope .sol', aderyn: 'n/a', patterns: 0, slitherOk: false } };
  const sl = slitherSweep(dir);
  const ad = existsSync(ADERYN) ? aderynSweep(dir) : { ok: false, reason: 'not installed', findings: [] };
  const pat = patternSweep(files, dir);
  const findings = triage([...sl.findings, ...ad.findings], pat);
  return { files, findings, sweepInfo: {
    slither: sl.ok ? `${sl.findings.length} kept (High/Med)` : `unavailable — ${sl.reason}`,
    aderyn: ad.ok ? `${ad.findings.length} kept` : `unavailable — ${ad.reason}`,
    patterns: pat.length, slitherOk: sl.ok, aderynOk: ad.ok } };
}

// ---- resolve source ----
function resolveSource(args) {
  if (args.target) {
    const tj = JSON.parse(readFileSync(path.join(LAB, 'config', 'bounty-targets.json'), 'utf8'));
    const t = (tj.targets || []).find(x => x.id === args.target);
    if (!t) throw new Error(`no bounty target '${args.target}' (try --list)`);
    if (!t.url || !/github\.com|\.git$/.test(t.repo || t.url || '')) {
      // many programs link a platform page, not a repo — be honest
      return { name: t.id, kind: 'note', note: `target '${t.name}' (${t.platform}) — scope at ${t.url}. ${t.access}. Provide the repo URL: node tools/audit.mjs <repo-url> --name ${t.id}` };
    }
    return { name: t.id, kind: 'git', url: t.repo || t.url };
  }
  const src = args._[0];
  if (!src) throw new Error('need a target: <git-url|local-path> or --target <id> or --list');
  if (existsSync(src)) return { name: args.name || path.basename(path.resolve(src)), kind: 'local', dir: path.resolve(src) };
  if (/^https?:\/\/|\.git$|^git@/.test(src)) return { name: args.name || src.replace(/\.git$/, '').split('/').pop(), kind: 'git', url: src };
  throw new Error(`'${src}' is neither a local path nor a git url`);
}

function checkout(src, args) {
  if (src.kind === 'local') return src.dir;
  const dir = path.join(tmpdir(), 'mesh-audit', src.name + '-' + Date.now().toString(36));
  mkdirSync(dir, { recursive: true });
  process.stderr.write(`  cloning ${src.url} …\n`);
  sh('git', ['clone', '--depth', '1', ...(args.commit ? [] : []), src.url, dir]);
  if (args.commit) { sh('git', ['-C', dir, 'fetch', '--depth', '1', 'origin', args.commit]); sh('git', ['-C', dir, 'checkout', args.commit]); }
  return args.sub ? path.join(dir, args.sub) : dir;
}

// ---- report ----
function writeReport(meta, findings, sweepInfo) {
  mkdirSync(REPORTS, { recursive: true });
  const counts = findings.reduce((a, f) => (a[f.severity] = (a[f.severity] || 0) + 1, a), {});
  const json = { ...meta, generated: new Date().toISOString(), counts, sweep: sweepInfo, findings };
  const base = path.join(REPORTS, meta.name.replace(/[^\w.-]/g, '_'));
  writeFileSync(base + '.json', JSON.stringify(json, null, 2));
  // markdown submission-draft
  const L = [];
  L.push(`# Audit pass — ${meta.name}`, '');
  L.push(`- **Target:** ${meta.source}`, `- **Commit:** ${meta.commit || '(HEAD of shallow clone)'}`, `- **Files in scope:** ${meta.files}`, `- **Generated:** ${json.generated}`, '');
  L.push(`**Tool sweep:** Slither ${sweepInfo.slither} · Aderyn ${sweepInfo.aderyn || 'n/a'}. **Pattern sweep:** ${sweepInfo.patterns} hits across ${meta.files} files.`, '');
  L.push(`> These are **leads, not confirmed bugs.** Each must be manually confirmed with a Foundry PoC (bug-hunt skill steps 4–6) before submission. Severity is a prior, not a verdict.`, '');
  L.push(`**Counts:** ${['high','medium','low'].map(s => `${counts[s]||0} ${s}`).join(' · ')}`, '');
  for (const sev of ['high', 'medium', 'low']) {
    const g = findings.filter(f => f.severity === sev);
    if (!g.length) continue;
    L.push(`## ${sev.toUpperCase()} (${g.length})`, '');
    for (const f of g) {
      L.push(`### [${f.source}] ${f.title}`);
      L.push(`- **Where:** \`${f.file}${f.line ? ':' + f.line : ''}\`  ·  **Class:** ${f.class || f.check}${f.confidence ? `  ·  **Confidence:** ${f.confidence}` : ''}`);
      if (f.snippet) L.push(`- **Code:** \`${f.snippet}\``);
      if (f.description) L.push(`- ${f.description.replace(/\n+/g, ' ')}`);
      if (f.why) L.push(`- **Confirm:** ${f.why}`);
      L.push('');
    }
  }
  writeFileSync(base + '.md', L.join('\n'));
  return { json: base + '.json', md: base + '.md', counts };
}

// ---- main ----
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--list') a.list = true;
    else if (t === '--target') a.target = argv[++i];
    else if (t === '--commit') a.commit = argv[++i];
    else if (t === '--sub') a.sub = argv[++i];
    else if (t === '--name') a.name = argv[++i];
    else a._.push(t);
  }
  return a;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) (async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    const tj = JSON.parse(readFileSync(path.join(LAB, 'config', 'bounty-targets.json'), 'utf8'));
    console.log('in-scope bounty targets (rank by odds × prize ÷ crowd; prefer newer/smaller):\n');
    for (const t of tj.targets) console.log(`  ${t.id.padEnd(16)} $${String(t.prize_usd).padEnd(9)} ${t.platform.padEnd(12)} ${t.odds.padEnd(14)} ${t.status}`);
    console.log(`\n  audit one: node tools/audit.mjs <repo-url> --name <id>   (most programs gate scope behind ${''}the operator's account)`);
    process.exit(0);
  }
  let src; try { src = resolveSource(args); } catch (e) { console.error('✗ ' + e.message); process.exit(2); }
  if (src.kind === 'note') { console.log('ℹ ' + src.note); process.exit(0); }

  console.log(`🔍 audit — ${src.name}`);
  let dir; try { dir = checkout(src, args); } catch (e) { console.error('✗ checkout failed: ' + String(e.message).split('\n')[0]); process.exit(1); }
  const auditRoot = (src.kind !== 'local' && args.sub) ? dir : dir; // checkout already applied --sub for git
  process.stdout.write('  sweeping (slither + aderyn + patterns) … ');
  const { files, findings, sweepInfo } = auditDir(auditRoot);
  if (!files.length) { console.error(`\n✗ no in-scope .sol found under ${dir}`); process.exit(1); }
  console.log(`${files.length} contracts · slither ${sweepInfo.slither} · aderyn ${sweepInfo.aderyn} · ${sweepInfo.patterns} patterns`);
  const r = writeReport({ name: src.name, source: src.url || src.dir || src.name, commit: args.commit, files: files.length }, findings, sweepInfo);

  console.log(`\n  ${['high','medium','low'].map(s => `${r.counts[s]||0} ${s}`).join(' · ')}  →  ${path.relative(LAB, r.md)}`);
  if (findings.length) {
    console.log('\n  top leads (confirm with a PoC before submitting):');
    findings.slice(0, 8).forEach(f => console.log(`   [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${(f.title || f.check).slice(0, 76)}`));
  } else {
    console.log('  clean sweep — no mechanical leads. Logic/economic bugs need the manual methodology pass (skill step 4).');
  }
  console.log('\n  honest: leads ≠ bounties. Most passes find nothing submittable. Confirm + PoC + dedup vs Solodit before submission.');
})();
