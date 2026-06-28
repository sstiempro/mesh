#!/usr/bin/env node
// Auto-protect governor — RL-lite control loop. Reads /api/health, holds each node inside a healthy
// envelope by live-retuning miner intensity via /api/node-tune. Purely protective by default: backs OFF
// fast under stress (so mining never fights the operator's own work — esp. Ausra), ramps up SLOW.
// State + decisions are written to logs/governor-state.json for the dashboard to surface.
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = path.join(LAB, 'config', 'governor.json');
const STATE = path.join(LAB, 'logs', 'governor-state.json');

const st = new Map();        // per-node hysteresis: {up, down}
const recent = [];           // ring buffer of recent actions
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function loadCfg() {
  try { return JSON.parse(await readFile(CFG, 'utf8')); }
  catch { return { enabled: false, intervalSec: 30, dashboard: 'http://127.0.0.1:8787', ladder: ['off','gentle','balanced','turbo'], threadsFor:{off:0,gentle:2,balanced:4,turbo:8}, default:{}, nodes:{} }; }
}
const idx = (ladder, p) => Math.max(0, ladder.indexOf(p));
const clamp = (i, lo, hi) => Math.max(lo, Math.min(hi, i));

function curPreset(node) {
  const mi = node.miner || {};
  if (!mi.mining) return 'off';
  if (mi.threads == null) return null;        // unknown intensity → caller holds, never guesses
  const t = mi.threads;
  if (t <= 0) return 'off'; if (t <= 2) return 'gentle'; if (t <= 4) return 'balanced'; return 'turbo';
}
function policyFor(name, cfg) {
  const base = { enabled: true, min: 'off', max: 'balanced', ceiling: 1.2, floor: 0.7, memFloor: 15, holdDown: 1, holdUp: 3, ...(cfg.default || {}) };
  for (const [k, v] of Object.entries(cfg.nodes || {})) {
    if (k.startsWith('_')) continue;
    if (name.toLowerCase().includes(k.toLowerCase())) return { ...base, ...v };
  }
  return base;
}

async function tick() {
  const cfg = await loadCfg();
  const ladder = cfg.ladder || ['off','gentle','balanced','turbo'];
  const decisions = [];
  if (!cfg.enabled) { await persist(cfg, [], 'disabled'); return; }

  let health;
  try { health = await (await fetch(`${cfg.dashboard}/api/health`, { signal: AbortSignal.timeout(8000) })).json(); }
  catch (e) { log('health fetch failed', String(e)); await persist(cfg, [], 'health-unreachable'); return; }

  for (const node of (health.nodes || [])) {
    if (node.kind !== 'mac') continue;                       // VPS are crunchers, not governed here
    const pol = policyFor(node.name, cfg);
    if (!pol.enabled) continue;
    const name = node.name;
    if (!node.online) { decisions.push({ name, online: false, note: 'offline — agent not reporting' }); continue; }

    const ratio = node.load?.ratio ?? 0;
    const mem = node.mem_free_pct ?? 100;
    const stressed = ratio > pol.ceiling || (mem >= 0 && mem < pol.memFloor) || node.thermal?.warn || node.throttling;
    const relaxed  = ratio < pol.floor && (mem < 0 || mem >= pol.memFloor + 10) && !node.thermal?.warn && !node.throttling;

    const reason = stressed ? `stressed (ratio ${ratio}, ram ${mem}%${node.thermal?.warn?', thermal':''}${node.throttling?', throttling':''})`
                 : relaxed ? `headroom (ratio ${ratio}, ram ${mem}%)` : `steady (ratio ${ratio})`;

    const s = st.get(name) || { up: 0, down: 0 };
    if (stressed) { s.down++; s.up = 0; } else if (relaxed) { s.up++; s.down = 0; } else { s.up = 0; s.down = 0; }
    st.set(name, s);

    const cur = curPreset(node);
    if (cur == null) {
      // unknown intensity (e.g. Ausra's backends empty) — but backing OFF is ALWAYS safe under stress
      if (stressed && node.miner?.mining && s.down >= (pol.holdDown || 1)) {
        try {
          await fetch(`${cfg.dashboard}/api/node-tune?name=${encodeURIComponent(name)}&preset=off`, { signal: AbortSignal.timeout(8000) });
          recent.unshift({ ts: Date.now(), name, change: '?→off', why: reason + ' · intensity unknown → safe pause', ok: true });
          recent.length = Math.min(recent.length, 25);
          st.set(name, { up: 0, down: 0 });
          log(`[govern] ${name}: paused (stressed, intensity unknown)`);
          decisions.push({ name, online: true, ratio, mem, cur: 'unknown', target: 'off', reason, action: 'paused (stressed)' });
        } catch (e) { decisions.push({ name, online: true, ratio, mem, cur: 'unknown', action: `pause failed ${String(e).slice(0,24)}` }); }
      } else decisions.push({ name, online: true, ratio, mem, cur: 'unknown', target: 'hold', reason, action: 'hold (intensity unknown)' });
      continue;
    }
    const loI = idx(ladder, pol.min), hiI = idx(ladder, pol.max), curI = idx(ladder, cur);
    let tgtI = curI;
    if (s.down >= (pol.holdDown || 1)) tgtI = curI - 1;          // back off fast
    else if (s.up >= (pol.holdUp || 3)) tgtI = curI + 1;          // ramp up slow
    tgtI = clamp(tgtI, loI, hiI);
    // respect mining-risk: never auto-RAMP a machine where mining is risky/AV-flagged (only hold or back off).
    // Stops the futile resume-loop on Ausra (AV quarantines her miner, so 'gentle' never sticks).
    const rl = node.mining_risk?.level;
    if (tgtI > curI && (rl === 'RISKY' || rl === 'UNSAFE')) tgtI = curI;
    const target = ladder[tgtI];

    const row = { name, online: true, ratio, mem, cur, target, reason };

    if (target !== cur) {
      try {
        const r = await fetch(`${cfg.dashboard}/api/node-tune?name=${encodeURIComponent(name)}&preset=${target}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
        row.action = r.error ? `FAILED ${String(r.error).slice(0,40)}` : `${cur} → ${target}`;
        st.set(name, { up: 0, down: 0 });                        // reset after acting
        recent.unshift({ ts: Date.now(), name, change: `${cur}→${target}`, why: reason, ok: !r.error });
        recent.length = Math.min(recent.length, 25);
        log(`[govern] ${name}: ${cur}→${target} (${reason})`);
      } catch (e) { row.action = `error ${String(e).slice(0,30)}`; }
    } else row.action = 'hold';
    decisions.push(row);
  }
  await persist(cfg, decisions, 'ok');
}

async function persist(cfg, decisions, status) {
  try {
    await writeFile(STATE, JSON.stringify({
      enabled: !!cfg.enabled, status, intervalSec: cfg.intervalSec || 20, ts: Date.now(),
      nodes: decisions, recent,
    }, null, 2));
  } catch (e) { log('state write failed', String(e)); }
}

async function loop() {
  for (;;) {
    const cfg = await loadCfg();
    try { await tick(); } catch (e) { log('tick error', String(e)); }
    await new Promise(r => setTimeout(r, Math.max(8, cfg.intervalSec || 20) * 1000));
  }
}
log('[governor] starting auto-protect loop');
loop();
