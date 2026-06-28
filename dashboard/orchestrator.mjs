#!/usr/bin/env node
// Master orchestrator — runs EVERY income micro-task/function on its own cadence and records each
// result over time (the forward-is-backward history), so the whole system is self-running, not
// on-demand. Also reflects the other daemons' freshness so there is ONE place that proves
// "all systems automated + running". Writes data/automation-status.json + per-task history jsonl.
import { readFile, writeFile, appendFile, mkdir, stat } from 'fs/promises';
import { exec } from 'node:child_process';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(LAB,'data');
const DASH = process.env.DASH || 'http://127.0.0.1:8787';
const TICK = +(process.env.ORCH_TICK_SEC || 60);                 // scheduler granularity
const log = (...a)=>console.log(new Date().toISOString(), ...a);
const getj = async (p)=>{ try{ return await (await fetch(`${DASH}${p}`,{signal:AbortSignal.timeout(20000)})).json(); }catch(e){ return {error:String(e)}; } };
const sh = (cmd)=> new Promise(r=> exec(cmd,{cwd:LAB,maxBuffer:1<<22,timeout:120000},(e,o)=>r({ok:!e,out:(o||'').slice(-400)})));

// each task: how to run it + how to summarize the result for the status board + optional history file
const TASKS = [
  { id:'strategist', every: 1800, hist:null,
    run: async()=>{ const d=await getj('/api/strategy'); return { ok:!d.error, summary:d.energy_ledger?`top transform: ${d.energy_ledger[0].transform.split('(')[0].trim()} [${d.energy_ledger[0].ratio}] · now: ${(d.now||'').slice(0,40)}…`:'err' }; } },
  { id:'formulation-test', every: 3600,  hist:'formulation-history.jsonl',
    run: async()=>{ const d=await getj('/api/formulations-test'); return { ok:!d.error, summary:d.counts?`RUNNING ${d.counts.RUNNING||0}/TESTABLE ${d.counts.TESTABLE||0}/OPERATOR ${d.counts.OPERATOR||0} · F&G ${d.pulse?.fng}`:'err',
      row:{ ts:Date.now(), counts:d.counts, fng:d.pulse?.fng, regime:d.pulse?.regime } }; } },
  { id:'compound-sim', every: 21600, hist:'compound-history.jsonl',
    run: async()=>{ const d=await getj('/api/compound'); const m=(t)=>{const x=(d.milestones||[]).find(y=>y.target===t);return x?Math.round(x.prob_reach*100):null;};
      return { ok:!d.error, summary:d.outcome_at_horizon?`p50 $${Math.round(d.outcome_at_horizon.p50)} · $1k ${m(1000)}% $10k ${m(10000)}% $1M ${m(1000000)}%`:'err',
      row:{ ts:Date.now(), p50:d.outcome_at_horizon?.p50, milestones:(d.milestones||[]).map(x=>({t:x.target,p:x.prob_reach})) } }; } },
  { id:'fringe-stack-mc', every: 21600, hist:null,
    run: async()=>{ const r=await sh('node tools/fringe-mc.mjs'); let s='ran'; try{ const j=JSON.parse(await readFile(path.join(DATA,'fringe-mc.json'),'utf8')); const b=(j.budgets||[]).find(x=>x.weekly===15); s=`15h/wk p50 $${b?.dist.p50}/mo · dominant: ${(j.dominant||[])[0]?.name||''}`; }catch{} return { ok:r.ok, summary:s }; } },
  { id:'opportunities', every: 1800, hist:'opportunity-digest.jsonl',
    run: async()=>{ const d=await getj('/api/opportunities'); return { ok:!d.error, summary:d.best_yield?`best yield ${d.best_yield.apy}% · arb ${d.best_arb?d.best_arb.net_bps+'bps':'—'}`:'err',
      row:{ ts:Date.now(), yield:d.best_yield?.apy, yield_proj:d.best_yield?.project, arb_net:d.best_arb?.net_bps, arb_ok:d.best_arb?.profitable } }; } },
  { id:'farm-rank', every: 21600, hist:null,
    run: async()=>{ const d=await getj('/api/farm'); return { ok:!d.error, summary:d.next?`next: ${(d.next.name||d.next.id||'')} · ${d.count} targets · $${d.potential_low}-${d.potential_high}/yr`:`${d.count||0} targets` }; } },
  { id:'free-streams', every: 21600, hist:null,
    run: async()=>{ const d=await getj('/api/free-streams'); return { ok:!d.error, summary:d.daily_drip_usd?`live $${d.daily_drip_usd.live?.[1]}/d · potential $${d.daily_drip_usd.full_potential?.[1]}/d · ${d.mesh_macs} Macs`:'err' }; } },
  { id:'knowledge-capital', every: 43200, hist:null,
    run: async()=>{ const d=await getj('/api/knowledge-capital'); return { ok:!d.error, summary:d.count?`${d.count} targets · passive ${d.passive?.length||0} · ai-can-do ${d.ai_now?.length||0}`:'err' }; } },
  { id:'eligibility', every: 21600, hist:'eligibility-history.jsonl',
    run: async()=>{ const d=await getj('/api/eligibility'); return { ok:true, summary:d.ready?`${d.wallets?.length||0} wallets tracked`:'add public addresses to wallets-watch.json',
      row: d.ready?{ ts:Date.now(), wallets:(d.wallets||[]).map(w=>({label:w.label,tx:w.tx_count})) }:null }; } },
];

const state = {}; // id -> {last, next, ok, summary}
async function fresh(file, withinSec){ try{ const s=await stat(path.join(DATA,file)); return (Date.now()-s.mtimeMs) < withinSec*1000; }catch{ return false; } }

async function runTask(t){
  try{ const r = await t.run();
    state[t.id] = { last:Date.now(), next:Date.now()+t.every*1000, ok:r.ok, summary:r.summary };
    if(t.hist && r.row){ await mkdir(DATA,{recursive:true}); await appendFile(path.join(DATA,t.hist), JSON.stringify(r.row)+'\n'); }
    log(`✓ ${t.id}: ${r.summary}`);
  }catch(e){ state[t.id]={ last:Date.now(), next:Date.now()+t.every*1000, ok:false, summary:'error '+String(e).slice(0,80) }; log(`✗ ${t.id}`, String(e)); }
}

async function writeStatus(){
  // reflect the OTHER daemons by output-file freshness so the board shows EVERYTHING automated
  const daemons = [
    { id:'scanner (yield/arb/pulse)', file:'opportunities.jsonl', every:180 },
    { id:'ledger (earnings)',        file:'ledger.jsonl',         every:3600 },
    { id:'content engine (brief)',   file:null, file2:'../reports/latest.json', every:86400 },
  ];
  const dstat=[];
  for(const d of daemons){ const f=d.file2||d.file; let ok=false; try{ const s=await stat(path.join(DATA,f)); ok=(Date.now()-s.mtimeMs)<d.every*3*1000; }catch{} dstat.push({ id:d.id, ok, kind:'daemon' }); }
  const tasks = TASKS.map(t=>({ id:t.id, kind:'task', ...(state[t.id]||{ok:null,summary:'pending first run'}) }));
  const all=[...tasks, ...dstat];
  const okN=all.filter(x=>x.ok).length;
  await mkdir(DATA,{recursive:true});
  await writeFile(path.join(DATA,'automation-status.json'), JSON.stringify({ ts:Date.now(), automated:all.length, healthy:okN, tasks, daemons:dstat },null,1));
}

async function loop(){
  log(`[orchestrator] starting · ${TASKS.length} tasks · tick ${TICK}s`);
  // run all once on boot (stagger lightly), then schedule
  for(const t of TASKS){ await runTask(t); }
  await writeStatus();
  for(;;){
    await new Promise(r=>setTimeout(r, TICK*1000));
    const now=Date.now();
    for(const t of TASKS){ if(!state[t.id] || now>=state[t.id].next){ await runTask(t); } }
    await writeStatus();
  }
}
loop();
