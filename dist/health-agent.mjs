#!/usr/bin/env node
// Uniform mesh node-agent. Runs on EVERY node (Air, Ausra, future boxes). Serves no-sudo
// health telemetry so the dashboard can render a per-node + mesh-wide speedometer and protect
// the hardware ("don't burn an M1's lifespan for pennies"). Binds the tailnet; token-gated.
//
//   HEALTH_PORT (default 18890)  HEALTH_TOKEN (default 'mesh')  XMRIG_PORT (default 18000)
//
// macOS no-sudo signals only: loadavg, mem free %, thermal-event flags, optional osx-cpu-temp,
// and the local xmrig hashrate (10s vs 15m = live throttle detector).
import http from 'http';
import os from 'os';
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT  = +(process.env.HEALTH_PORT  || 18890);
const TOKEN = process.env.HEALTH_TOKEN || 'mesh';

const sh = (cmd) => new Promise(r => exec(cmd, { timeout: 4000 }, (e, so) => r(e ? '' : so.trim())));
const num = (s, re, d = 0) => { const m = (s || '').match(re); return m ? +m[1] : d; };

async function xmrigSummary() {
  // read miner port/token from the lab config, fall back to env/defaults
  let port = +(process.env.XMRIG_PORT || 0), tok = process.env.XMRIG_TOKEN || '';
  try {
    const c = JSON.parse(await readFile(path.join(LAB, 'config', 'xmrig.json'), 'utf8'));
    port = port || c?.http?.port || 18000; tok = tok || c?.http?.['access-token'] || '';
  } catch { port = port || 18000; }
  const H = tok ? { Authorization: `Bearer ${tok}` } : {};
  try {
    const [sumR, beR] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/2/summary`,  { headers: H, signal: AbortSignal.timeout(2500) }),
      fetch(`http://127.0.0.1:${port}/2/backends`, { headers: H, signal: AbortSignal.timeout(2500) }).catch(() => null),
    ]);
    const d = await sumR.json();
    // authoritative MINING-thread count = cpu backend's threads array (NOT cpu.threads, which is total logical CPUs)
    let threads = null;
    if (beR && beR.ok) { const be = await beR.json(); const cpu = (be || []).find(x => x.type === 'cpu'); if (cpu && Array.isArray(cpu.threads)) threads = cpu.threads.length; }
    if (threads == null && Array.isArray(d?.hashrate?.threads)) threads = d.hashrate.threads.length;
    // last resort: read the authoritative thread map from the running config (works where backends is empty, e.g. Ausra)
    if (threads == null) {
      try { const cfgR = await fetch(`http://127.0.0.1:${port}/1/config`, { headers: H, signal: AbortSignal.timeout(2000) });
        if (cfgR.ok) { const c = await cfgR.json(); if (Array.isArray(c?.cpu?.rx)) threads = c.cpu.rx.length; } } catch {}
    }
    const h = d?.hashrate?.total || [];
    return {
      mining: true, algo: d?.algo || null, threads,
      h10s: +(h[0] || 0), h60s: +(h[1] || 0), h15m: +(h[2] || 0),
      uptime: d?.uptime ?? null,
    };
  } catch { return { mining: false, h10s: 0, h60s: 0, h15m: 0, threads: null, algo: null, uptime: null }; }
}

async function telemetry() {
  const ncpu = os.cpus().length;
  const [l1, l5, l15] = os.loadavg();
  const [pcpu, ecpu, model, memPct, therm, temp] = await Promise.all([
    sh('sysctl -n hw.perflevel0.logicalcpu'),
    sh('sysctl -n hw.perflevel1.logicalcpu'),
    sh('sysctl -n hw.model'),
    sh('memory_pressure'),
    sh('pmset -g therm'),
    sh('command -v osx-cpu-temp >/dev/null 2>&1 && osx-cpu-temp || true'),
  ]);

  const memFreePct = num(memPct, /free percentage:\s*(\d+)/, -1);
  // pmset -g therm: "No thermal warning level has been recorded" = healthy; a number = throttling
  const thermalWarn = /thermal warning level:\s*[1-9]/i.test(therm) || /CPU_Scheduler_Limit\s*=\s*[1-9]\d?\b/.test(therm);
  const speedLimit = num(therm, /CPU_Speed_Limit\s*=\s*(\d+)/, 100);
  const cpuTempC = num(temp, /([\d.]+)/, -1);

  const xm = await xmrigSummary();
  const loadRatio = +(l1 / Math.max(1, ncpu)).toFixed(2);

  // honest throttle detector: live 10s hashrate well below the 15m average while mining
  const throttling = xm.mining && xm.h15m > 0 && xm.h10s < 0.72 * xm.h15m;

  // health score (0-100): start full, subtract real stress
  let score = 100;
  if (loadRatio > 1) score -= Math.min(50, (loadRatio - 1) * 45);   // oversubscription is the big one
  if (memFreePct >= 0 && memFreePct < 20) score -= (20 - memFreePct) * 1.5;
  if (memFreePct >= 0 && memFreePct < 10) score -= 15;              // thrash danger
  if (thermalWarn || speedLimit < 100) score -= 25;
  if (throttling) score -= 15;
  if (cpuTempC > 90) score -= 20; else if (cpuTempC > 80) score -= 8;
  score = Math.max(0, Math.round(score));

  const status = score >= 80 ? 'good' : score >= 60 ? 'strain' : score >= 40 ? 'hot' : 'critical';
  // what the operator/AI guard should do
  let advice = 'healthy — run as is';
  if (status === 'strain') advice = 'oversubscribed — fine briefly, watch it';
  if (status === 'hot') advice = 'throttle: drop miner threads or pause on this node';
  if (status === 'critical') advice = 'PROTECT: pause miner — sustained strain shortens lifespan';
  if (memFreePct >= 0 && memFreePct < 12) advice = 'RAM thrash — switch to light mode / fewer threads';

  return {
    host: os.hostname().replace(/\.local$/, ''),
    model: model || 'mac', ncpu, pcpu: +pcpu || null, ecpu: +ecpu || null,
    load: { l1: +l1.toFixed(2), l5: +l5.toFixed(2), l15: +l15.toFixed(2), ratio: loadRatio },
    mem_free_pct: memFreePct, sys_uptime_s: os.uptime(),
    thermal: { warn: thermalWarn, speed_limit: speedLimit, temp_c: cpuTempC >= 0 ? cpuTempC : null },
    miner: xm, throttling,
    score, status, advice, ts: Date.now(),
  };
}

http.createServer(async (req, res) => {
  const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health' || u.pathname === '/') {
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || u.searchParams.get('token') || '';
    if (TOKEN && tok !== TOKEN) return send(401, { error: 'unauthorized' });
    try { return send(200, await telemetry()); } catch (e) { return send(500, { error: String(e) }); }
  }
  send(404, { error: 'not found' });
}).listen(PORT, '0.0.0.0', () => console.log(`[health-agent] :${PORT} (token-gated, tailnet)`));
