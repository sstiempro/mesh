// Fleet + wallet dashboard server — localhost only. Shows the Tailscale mesh, the live miner,
// pool-side fleet stats (MoneroOcean), and the local wallet (balance + send via monero-wallet-rpc).
// SECURITY: binds 127.0.0.1 only. /api/send hits the LOCAL wallet-rpc (also 127.0.0.1). If this
// dashboard is ever exposed across the tailnet, do NOT expose /api/send — keep spend on the Mac.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPro, gate, tierInfo, proArtifact, pricing } from './premium.mjs';
import { runAll as runMonitors, loadRegistry as loadMonitorRegistry } from './monitors.mjs';
import { executionView, resolveAction, publicFeed, signalTapeView, digest, regimeView } from './execution.mjs';
import { grantFitView, runGrantFit } from './grant-fit.mjs';
import { hackathonFitView, runHackathonFit } from './hackathon-fit.mjs';
import { persistenceView, runPersistence, durabilityOf } from './persistence.mjs';
import { carryView, runCarry } from './carry.mjs';
import { contestSniperView } from './contest-sniper.mjs';
import { referralStatus } from './referral.mjs';
import { paperView } from './paper-engine.mjs';
import { credSummary } from './credentials.mjs';
import { workPacketSummary } from './work-cruncher.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8787;
const MO = 'https://api.moneroocean.stream';
const TS = '/opt/homebrew/bin/tailscale';
const WRPC = 'http://127.0.0.1:18088/json_rpc';
// /api/send confirm gate (2026-07-01): the first call used to fire the real wallet-rpc transfer
// immediately off a bare address+amount form, no confirmation step. Now it's two-phase: first call
// stages a token (2min TTL), second call with that token actually executes the transfer.
const pendingSends = new Map();

const sh = (cmd) => new Promise(r => exec(cmd, { maxBuffer: 1 << 20 }, (e,o)=>r(e?'':o)));
async function cfg(){ try { return JSON.parse(await readFile(path.join(LAB,'config','xmrig.json'),'utf8')); } catch { return {}; } }
async function coins(){ try { return JSON.parse(await readFile(path.join(LAB,'config','coins.json'),'utf8')); } catch { return {active:null,coins:[]}; } }
// Poll BOTH VPS for BOINC/Gridcoin state. contabo via key, ovh via tailscale-ssh (root).
const BOXES=[
  {name:'contabo', ssh:`ssh -i ${process.env.HOME}/.ssh/YOUR_SSH_KEY -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -o BatchMode=yes root@VPS_IP`},
  {name:'ovh',     ssh:`ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -o BatchMode=yes root@TAILNET_IP`},
];
async function boincBox(b){
  const out=await sh(`${b.ssh} "cd /var/lib/boinc-client; echo AM:\\$(boinccmd --acct_mgr info 2>/dev/null | grep -c grcpool); echo RUN:\\$(boinccmd --get_tasks 2>/dev/null | grep -c 'active_task_state: EXECUTING'); echo TOT:\\$(boinccmd --get_tasks 2>/dev/null | grep -c 'WU name:'); echo LOAD:\\$(cut -d' ' -f1 /proc/loadavg); echo NPROC:\\$(nproc); boinccmd --get_project_status 2>/dev/null | grep -m1 'name:'; boinccmd --get_project_status 2>/dev/null | grep -m1 'master URL'; boinccmd --get_project_status 2>/dev/null | grep -E 'host_total_credit|host_expavg_credit|user_expavg_credit'; boinccmd --get_tasks 2>/dev/null | grep 'fraction done:'"`);
  if(!out) return {name:b.name, reachable:false, status:'unreachable', running:0, queued:0, progress:0, cpu_pct:null};
  const am=/AM:[1-9]/.test(out);
  const projName=(out.match(/name:\s*(.+)/)||[])[1]?.trim()||null;
  const projUrl=(out.match(/master URL:\s*(\S+)/)||[])[1]||null;
  const running=+((out.match(/RUN:(\d+)/)||[])[1]||0);
  const queued=+((out.match(/TOT:(\d+)/)||[])[1]||0);
  const load=+((out.match(/LOAD:([\d.]+)/)||[])[1]||0);
  const nproc=+((out.match(/NPROC:(\d+)/)||[])[1]||0);
  const fracs=(out.match(/fraction done:\s*([\d.]+)/g)||[]).map(s=>+s.replace(/[^\d.]/g,''));
  const progress=fracs.length?+(fracs.reduce((a,c)=>a+c,0)/fracs.length).toFixed(3):0;
  const cpu_pct=nproc?Math.min(100,Math.round(load/nproc*100)):null;
  const credit=+((out.match(/host_total_credit:\s*([\d.]+)/)||[])[1]||0);
  const rac=+((out.match(/host_expavg_credit:\s*([\d.]+)/)||[])[1]||0);
  const poolRac=+((out.match(/user_expavg_credit:\s*([\d.]+)/)||[])[1]||0);
  const proj=projName||projUrl;
  let status;
  if(proj) status='computing · '+running+'/'+queued+' tasks';
  else if(am) status='grcpool linked · enable projects';
  else status='installed · attach pending';
  return {name:b.name, reachable:true, am, project:proj, projUrl, tasks:queued, running, queued, progress, load, nproc, cpu_pct, credit, rac, poolRac, status};
}
let _boinc={t:0,d:null};
async function boinc(){
  if(Date.now()-_boinc.t<60000 && _boinc.d) return _boinc.d;
  const boxes=await Promise.all(BOXES.map(boincBox));
  const crunching=boxes.filter(x=>x.project).length, linked=boxes.filter(x=>x.am||x.project).length;
  const d={boxes, summary:`${crunching}/${boxes.length} crunching · ${linked}/${boxes.length} grcpool-linked`};
  _boinc={t:Date.now(),d}; return d;
}
async function getj(u){ try { const r=await fetch(u); return await r.json(); } catch(e){ return {error:String(e)}; } }
async function rpc(method, params={}){
  try { const r=await fetch(WRPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'0',method,params})});
    const j=await r.json(); return j.result || {error:(j.error&&j.error.message)||'rpc error'}; }
  catch { return {error:'wallet-rpc offline'}; }
}
async function localSummary(){ const c=await cfg(); const t=c?.http?.['access-token']||''; const p=c?.http?.port||18000;
  try { const r=await fetch(`http://127.0.0.1:${p}/2/summary`,{headers:{Authorization:`Bearer ${t}`}}); return await r.json(); } catch { return {error:'local miner offline'}; } }
let _price={t:0,v:0};
async function xmrPrice(){ if(Date.now()-_price.t<300000 && _price.v) return _price.v;  // keyless Kraken public ticker, 5min cache
  try{ const j=await getj('https://api.kraken.com/0/public/Ticker?pair=XMRUSD'); const k=Object.keys(j?.result||{})[0]; const v=+(j.result[k].c[0]); if(v>0){ _price={t:Date.now(),v}; return v; } }catch{}
  return _price.v||230; }
let _grcp={t:0,v:0};
async function grcPrice(){ if(Date.now()-_grcp.t<300000 && _grcp.v) return _grcp.v;  // keyless CoinGecko, 5min cache
  try{ const j=await getj('https://api.coingecko.com/api/v3/simple/price?ids=gridcoin-research&vs_currencies=usd'); const v=+(j?.['gridcoin-research']?.usd); if(v>0){ _grcp={t:Date.now(),v}; return v; } }catch{}
  return _grcp.v||0.0024; }
async function fleet(){ const c=await cfg(); const a=c?.pools?.[0]?.user||''; if(!a||a.startsWith('REPLACE')) return {error:'no wallet'};
  const stats=await getj(`${MO}/miner/${a}/stats`); let ids=await getj(`${MO}/miner/${a}/identifiers`); if(!Array.isArray(ids)) ids=[];
  const workers=await Promise.all(ids.map(async id=>({id,...(await getj(`${MO}/miner/${a}/stats/${encodeURIComponent(id)}`))}))); return {address:a, stats, workers}; }
async function mesh(){ const out=(await sh(`${TS} status --json`))||(await sh(`tailscale status --json`));
  try { const d=JSON.parse(out); const nodes=[]; const add=(p,self=false)=>nodes.push({name:p.HostName,os:p.OS,ip:(p.TailscaleIPs||[])[0],online:!!p.Online,self});
    if(d.Self) add(d.Self,true); for(const p of Object.values(d.Peer||{})) add(p); return {nodes}; } catch { return {error:'tailscale not readable'}; } }
async function wallet(){ const bal=await rpc('get_balance'); const addr=await rpc('get_address');
  return { ok:!bal.error, balance:bal.balance||0, unlocked:bal.unlocked_balance||0, address:addr.address||'', err:bal.error||null }; }
async function gstate(){ return (await readFile(path.join(LAB,'logs','state.txt'),'utf8').catch(()=> 'direct')).trim(); }

// Direct-probe each Mac's own xmrig HTTP API over the tailnet → live hashrate the INSTANT it mines,
// with no ~20-min wait for the first MoneroOcean pool share. Add a node's tailnet endpoint here when
// you onboard it (the v2 Ausra installer exposes its API on the tailnet for exactly this).
const MESH_MINERS=[
  {name:'Ausra-The-Fool', url:'http://TAILNET_IP:18000', tok:'mesh', kind:'cpu'},
  // VPS XMR endpoints removed — boxes reverted to ToS-safe GRC. Re-add if XMR is redeployed:
  // {name:'contabo-vps', url:'http://TAILNET_IP:18000', tok:'mesh', kind:'vps'},
  // {name:'ovh-vps', url:'http://TAILNET_IP:18000', tok:'mesh', kind:'vps'},
];
async function meshMiners(){
  const c=await cfg(); const lt=c?.http?.['access-token']||''; const lp=c?.http?.port||18000;
  const localName=c?.pools?.[0]?.['rig-id']||'m1-air';
  const probes=[ {name:localName, url:`http://127.0.0.1:${lp}`, tok:lt}, ...MESH_MINERS ];
  return Promise.all(probes.map(async pr=>{
    try{ const r=await fetch(pr.url+'/2/summary',{headers:{Authorization:`Bearer ${pr.tok}`},signal:AbortSignal.timeout(2500)});
      const j=await r.json(); const hr=Math.round(j?.hashrate?.total?.[0]||0);
      return {name:pr.name, kind:pr.kind||'cpu', coin:'XMR', algo:j?.algo||'rx/0', hashrate:hr, status:hr>0?'mining':(j?'warming up':'idle'), online:true};
    }catch{ return {name:pr.name, kind:pr.kind||'cpu', coin:'XMR', algo:'rx/0', hashrate:0, status:'unreachable', online:false}; }
  }));
}

// Unified FLEET view: every machine + which coin it mines + live metric. Composes the other probes
// server-side so the UI is one call and bulletproof.
async function overview(){
  const [loc, fl, bo, me, direct] = await Promise.all([localSummary(), fleet(), boinc(), mesh(), meshMiners()]);
  const meshNodes = me?.nodes || [];
  const localHr = Math.round(loc?.hashrate?.total?.[0] || 0);
  // XMR machines: DIRECT per-Mac probes (immediate, no pool lag) + any MoneroOcean worker we don't probe directly.
  const directNames = new Set(direct.map(d=>String(d.name).toLowerCase()));
  const workers = Array.isArray(fl?.workers) ? fl.workers : [];
  const poolOnly = workers.filter(w=>!directNames.has(String(w.id||'').toLowerCase())).map(w=>{
    const hr=Math.round(w.hash||0); return {name:w.id,kind:'cpu',coin:'XMR',algo:'rx/0',hashrate:hr,status:hr>0?'mining':'idle',online:true};
  });
  const xmr = [...direct, ...poolOnly];
  // GRC crunchers (VPS, useful-work / BOINC) — but drop any box that's been switched to XMR mining
  // (its base name appears as an XMR rig like "contabo"→"contabo-vps"), so it doesn't double-list.
  const xmrBases = new Set(direct.filter(d=>d.hashrate>0||d.status==='warming up').map(d=>String(d.name).toLowerCase().replace(/-vps$/,'')));
  const grc = (bo?.boxes||[]).filter(b=>!xmrBases.has(String(b.name).toLowerCase())).map(b=>({ name:b.name, kind:'vps', coin:'GRC', algo:'BOINC',
    hashrate:null, tasks:b.tasks||0, running:b.running||0, queued:b.queued||0, progress:b.progress||0,
    cpu_pct:b.cpu_pct??null, project:b.project||null, credit:b.credit||0, rac:b.rac||0, nproc:b.nproc||0,
    status:b.status||'—', online:!!b.reachable }));
  const machines = [...xmr, ...grc];
  const totalXmrHr = xmr.reduce((s,m)=>s+(m.hashrate||0),0);
  const st = fl?.stats || {};
  const div = 1e12;
  const price = await xmrPrice();
  const perKhDay = 0.004376/54;                       // XMR mined per kH/s per day at current net difficulty
  const xmrDay = (totalXmrHr/1000)*perKhDay;
  const usdDay = +(xmrDay*price).toFixed(4);
  const pendingXmr = st.amtDue!=null ? +(st.amtDue/div).toFixed(6) : 0;
  const paidXmr = st.amtPaid!=null ? +(st.amtPaid/div).toFixed(6) : 0;
  const pendingUsd = +((pendingXmr)*price).toFixed(3);
  // GRC: grcpool credits GRC from BOINC credit. No public per-member API → estimate from our hosts' credit/RAC.
  const grcP = await grcPrice();
  const grcCredit = grc.reduce((s,g)=>s+(g.credit||0),0);   // credit GRANTED to our hosts (0 until a task validates)
  const grcRac = grc.reduce((s,g)=>s+(g.rac||0),0);         // credit/day (RAC) — builds over ~weeks
  const GRC_PER_CREDIT = 1/5000;                            // ROUGH community heuristic; varies a lot — clearly flagged in UI
  const grcEarned = +(grcCredit*GRC_PER_CREDIT).toFixed(4);
  const grcPerDay = +(grcRac*GRC_PER_CREDIT).toFixed(4);
  const grcUsdDay = +(grcPerDay*grcP).toFixed(5);
  const grcEarnedUsd = +(grcEarned*grcP).toFixed(4);
  // PROJECTED steady-state (since granted credit=0 until tasks validate): ~2000 RAC/Asteroids-core/day × 0.6 throttle.
  const grcCores = grc.filter(g=>/comput/.test(g.status)).reduce((s,g)=>s+(g.nproc||0),0);
  const projRac = grcRac>0 ? grcRac : Math.round(grcCores*2000*0.6);
  const grcProjPerDay = +(projRac*GRC_PER_CREDIT).toFixed(3);
  const grcProjUsdDay = +(grcProjPerDay*grcP).toFixed(5);
  const fleetUsdDay = +(usdDay+grcUsdDay).toFixed(4);
  const eta100 = fleetUsdDay>0 ? Math.max(0, Math.round((100-pendingUsd-grcEarnedUsd)/fleetUsdDay)) : null;
  return {
    totals: {
      xmr_hashrate: totalXmrHr,
      xmr_machines: xmr.filter(x=>x.status==='mining').length,
      grc_machines: grc.filter(g=>/computing/.test(g.status)).length,
      nodes_online: meshNodes.filter(n=>n.online).length,
      nodes_total: meshNodes.length,
      pending_xmr: pendingXmr, paid_xmr: paidXmr,
      xmr_price: price, usd_per_day: usdDay, xmr_per_day: +xmrDay.toFixed(6),
      pending_usd: pendingUsd, eta_100_days: eta100,
      grc_price: grcP, grc_credit: +grcCredit.toFixed(1), grc_rac: +grcRac.toFixed(1),
      grc_earned: grcEarned, grc_per_day: grcPerDay, grc_usd_day: grcUsdDay, grc_earned_usd: grcEarnedUsd,
      grc_cores: grcCores, grc_proj_per_day: grcProjPerDay, grc_proj_usd_day: grcProjUsdDay,
      fleet_usd_day: fleetUsdDay,
    },
    coins: [
      {coin:'XMR', chain:'Monero · RandomX', machines:xmr.length, hashrate:totalXmrHr, mining:xmr.some(x=>x.status==='mining')},
      {coin:'GRC', chain:'Gridcoin · BOINC useful-work', machines:grc.length, hashrate:null, mining:grc.some(g=>/computing/.test(g.status))},
    ],
    machines, mesh: meshNodes,
  };
}

// DRILL-DOWN: deep detail for one machine. Mac → full xmrig summary (per-thread H/s, shares, pool, ping,
// difficulty, uptime). VPS → BOINC project + per-task progress list + CPU/load.
async function machineDetail(name){
  const lname=String(name||'').toLowerCase();
  const box=BOXES.find(b=>b.name.toLowerCase()===lname);
  if(box){
    const out=await sh(`${box.ssh} "echo NPROC:\\$(nproc); echo LOAD:\\$(cut -d' ' -f1-3 /proc/loadavg); cd /var/lib/boinc-client; boinccmd --get_project_status 2>/dev/null | grep -m1 'name:'; boinccmd --get_tasks 2>/dev/null | grep -E 'WU name:|fraction done:|active_task_state:|current CPU time:|estimated CPU time remaining:' | head -160"`);
    if(!out) return {kind:'vps', name, online:false, error:'VPS unreachable'};
    const nproc=+((out.match(/NPROC:(\d+)/)||[])[1]||0);
    const load=(out.match(/LOAD:([\d. ]+)/)||[])[1]?.trim()||'';
    const project=(out.match(/name:\s*(.+)/)||[])[1]?.trim()||null;
    // group task lines into objects
    const tasks=[]; let cur=null;
    for(const line of out.split('\n')){
      const wu=line.match(/WU name:\s*(.+)/); if(wu){ cur={wu:wu[1].trim()}; tasks.push(cur); continue; }
      if(!cur) continue;
      const fd=line.match(/fraction done:\s*([\d.]+)/); if(fd){ cur.progress=+ (+fd[1]).toFixed(4); continue; }
      const ts=line.match(/active_task_state:\s*(\w+)/); if(ts){ cur.state=ts[1]; continue; }
      const ct=line.match(/current CPU time:\s*([\d.]+)/); if(ct){ cur.cpu_time=+ct[1]; }
    }
    const load1=+(load.split(/\s+/)[0]||0);
    return {kind:'vps', name, online:true, project, nproc, load,
      cpu_pct: nproc? Math.min(100,Math.round(load1/nproc*100)):null,
      running: tasks.filter(t=>t.state==='EXECUTING').length, total: tasks.length,
      tasks: tasks.slice(0,12) };
  }
  const c=await cfg();
  const eps=[{name:c?.pools?.[0]?.['rig-id']||'m1-air', url:`http://127.0.0.1:${c?.http?.port||18000}`, tok:c?.http?.['access-token']||''}, ...MESH_MINERS];
  const ep=eps.find(e=>e.name.toLowerCase()===lname);
  if(ep){
    try{ const H={Authorization:`Bearer ${ep.tok}`};
      const [r,rb]=await Promise.all([ fetch(ep.url+'/2/summary',{headers:H,signal:AbortSignal.timeout(3500)}),
        fetch(ep.url+'/2/backends',{headers:H,signal:AbortSignal.timeout(3500)}).catch(()=>null) ]);
      const j=await r.json();
      let threads=(j?.hashrate?.threads||[]).map(t=>Math.round((t&&t[0])||0));
      if(!threads.length && rb){ try{ const be=await rb.json(); const cpu=Array.isArray(be)?be.find(b=>b?.type==='cpu'):null;
        if(Array.isArray(cpu?.threads)) threads=cpu.threads.map(t=>Math.round((t?.hashrate&&t.hashrate[0])||0)); }catch{} }
      return {kind:'cpu', name:ep.name, online:true, algo:j?.algo||'rx/0', uptime:j?.uptime||0,
        hashrate:{ total:(j?.hashrate?.total||[]).map(x=>Math.round(x||0)), highest:Math.round(j?.hashrate?.highest||0), threads },
        shares:{ good:j?.results?.shares_good||0, total:j?.results?.shares_total||0, diff:j?.results?.diff_current||0,
                 avg_time:j?.results?.avg_time||0, hashes:j?.results?.hashes_total||0 },
        pool:{ host:j?.connection?.pool||'', ping:j?.connection?.ping||0, uptime:j?.connection?.uptime||0,
               accepted:j?.connection?.accepted||0, rejected:j?.connection?.rejected||0, diff:j?.connection?.diff||0 },
        cpu:{ brand:j?.cpu?.brand||'', cores:j?.cpu?.cores||0, threads:j?.cpu?.threads||0, arch:j?.cpu?.arch||'' },
        memory:{ hugepages:j?.hugepages||null, restricted:j?.cpu?.['hw-aes'] }, donate:j?.['donate-level'] };
    }catch{ return {kind:'cpu', name:ep.name, online:false, error:'miner API unreachable (re-run the installer on this Mac to expose it on the tailnet)'}; }
  }
  return {error:'unknown machine: '+name};
}

// CONTROL one machine. Mac → xmrig pause/resume (over its API) / restart (local). VPS → BOINC run mode.
async function machineControl(name, action){
  const lname=String(name||'').toLowerCase();
  const box=BOXES.find(b=>b.name.toLowerCase()===lname);
  if(box){
    const map={pause:'--set_run_mode never', resume:'--set_run_mode always', restart:'--set_run_mode always'};
    if(!map[action]) return {error:'action must be pause|resume|restart'};
    await sh(`${box.ssh} "cd /var/lib/boinc-client && boinccmd ${map[action]}"`);
    return {ok:true, name, action, note:`Gridcoin ${action==='pause'?'suspended':'running'}`};
  }
  const c=await cfg();
  const eps=[{name:c?.pools?.[0]?.['rig-id']||'m1-air', url:`http://127.0.0.1:${c?.http?.port||18000}`, tok:c?.http?.['access-token']||'', local:true}, ...MESH_MINERS];
  const ep=eps.find(e=>e.name.toLowerCase()===lname);
  if(ep){
    if(action==='restart'){ if(!ep.local) return {error:'restart only on the local Mac (remote: it auto-restarts via its watchdog)'};
      return new Promise(res=>exec(`"${LAB}/bin/mine-flatout.sh"`,(e,o)=>res({ok:!e,name,action,out:(o||'').trim()}))); }
    if(action==='pause'||action==='resume'){
      try{ const r=await fetch(ep.url+'/json_rpc',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${ep.tok}`},body:JSON.stringify({method:action})}); return {ok:true,name,action,res:await r.json()}; }
      catch{ return {error:'miner API unreachable'}; }
    }
    return {error:'action must be pause|resume|restart'};
  }
  return {error:'unknown machine: '+name};
}
// Payout history from MoneroOcean → earnings-over-time chart.
async function payments(){ const c=await cfg(); const a=c?.pools?.[0]?.user||''; if(!a) return {payments:[], total:0};
  let p=await getj(`${MO}/miner/${a}/payments`); if(!Array.isArray(p)) p=[];
  const list=p.map(x=>{ if(typeof x==='string'){ const [ts,amt,txn]=x.split(':'); return {ts:+ts, amount:(+amt)/1e12, txn}; }
    return {ts:x.ts||x.time||0, amount:(x.amount||0)/1e12, txn:x.txnHash||x.txn||''}; }).filter(x=>x.amount>0).sort((a,b)=>a.ts-b.ts);
  return {payments:list, total:+list.reduce((s,x)=>s+x.amount,0).toFixed(6)}; }

// FLEET-WIDE control: apply pause/resume/restart to every machine at once.
async function fleetControl(action){
  const c=await cfg();
  const names=[c?.pools?.[0]?.['rig-id']||'m1-air', ...MESH_MINERS.map(m=>m.name), ...BOXES.map(b=>b.name)];
  const results=await Promise.all(names.map(async n=>({name:n, ...(await machineControl(n,action))})));
  return {action, ok:results.filter(r=>r.ok).length, total:results.length, results};
}
// Multi-coin price helper (CoinGecko, keyless, 5min cache).
let _cgp={t:0,key:'',d:{}};
async function coinPrices(ids){ const key=[...ids].sort().join(','); if(Date.now()-_cgp.t<300000 && _cgp.key===key) return _cgp.d;
  try{ const j=await getj(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`);
    const d={}; for(const k in j) d[k]=j[k]?.usd||0; _cgp={t:Date.now(),key,d}; return d; }catch{ return _cgp.d||{}; } }

// INCOME aggregator — every stream's $/day in one place (the "personal Binance" view).
async function income(){
  let cfg; try{ cfg=JSON.parse(await readFile(path.join(LAB,'config','income-streams.json'),'utf8')); }catch{ cfg={streams:[]}; }
  const streams=cfg.streams||[];
  const ov=await overview().catch(()=>({totals:{}}));
  const liveMine=ov?.totals?.fleet_usd_day ?? ov?.totals?.usd_per_day ?? 0;
  const ids=[...new Set(streams.filter(s=>s.price_id).map(s=>s.price_id))];
  const prices=ids.length? await coinPrices(ids):{};
  const out=streams.map(s=>{
    let daily=+(s.est_daily_usd||0), value=null;
    if(s.source==='live:moneroocean') daily=+(liveMine).toFixed(4);
    if(s.amount&&s.price_id){ const px=prices[s.price_id]||0; value=+(px*s.amount).toFixed(2); if(s.apy_pct) daily=+(value*(s.apy_pct/100)/365).toFixed(4); }
    return {...s, value_usd:value, daily_usd:daily};
  });
  const total=+out.reduce((a,s)=>a+(s.daily_usd||0),0).toFixed(4);
  const byCat={}; for(const s of out) byCat[s.category]=+((byCat[s.category]||0)+(s.daily_usd||0)).toFixed(4);
  const held=+out.reduce((a,s)=>a+(s.value_usd||0),0).toFixed(2);
  return {streams:out, total_daily_usd:total, by_category:byCat, held_value_usd:held, dollar_day_pct:Math.min(100,Math.round(total*100))};
}
// ── Mesh health / speedometer ─────────────────────────────────────────────
// Every Mac runs health-agent.mjs (:18890). The VPS are linux → health derived from BOINC load.
const HEALTH_TOKEN = process.env.HEALTH_TOKEN || 'mesh';
const HEALTH_NODES = [
  { name: 'Joey’s MacBook Air', url: 'http://127.0.0.1:18890',     kind: 'mac', role: 'daily-driver',     miner:{ local:true } },
  // Ausra runs her OWN heavy programs — she is NOT a dedicated miner. Mine gentle/off, on demand.
  { name: 'Ausra-The-Fool',         url: 'http://TAILNET_IP:18890',  kind: 'mac', role: 'her own rig',   miner:{ url:'http://TAILNET_IP:18000', tok:'mesh' } },
  // rest of the tailnet Macs — show on the dashboard even when offline (full mesh roster)
  { name: 'thomass-laptop',         url: 'http://TAILNET_IP:18890', kind: 'mac', role: 'spare',         miner:{ url:'http://TAILNET_IP:18000', tok:'mesh' } },
];
// live miner re-tune over the tailnet (no SSH/restart): PUT /1/config with new thread map + mode.
const TUNE_PRESETS = { gentle:{rx:[-1,-1],mode:'light'}, balanced:{rx:[-1,-1,-1,-1],mode:'light'}, turbo:{rx:[-1,-1,-1,-1,-1,-1,-1,-1],mode:'fast'} };
async function nodeTune(name, preset){
  const node = HEALTH_NODES.find(n=>n.name===name);
  if(!node || node.kind!=='mac') return { error:'unknown or non-tunable node', name };
  const c = await cfg(); const lTok=c?.http?.['access-token']||''; const lPort=c?.http?.port||18000;
  const url = node.miner?.local ? `http://127.0.0.1:${lPort}` : node.miner?.url;
  const tok = node.miner?.local ? lTok : (node.miner?.tok||'mesh');
  if(!url) return { error:'no miner endpoint for this node', name };
  const H = { Authorization:`Bearer ${tok}` };
  try {
    if(preset==='off' || preset==='on'){
      const method = preset==='off' ? 'pause' : 'resume';
      const r=await fetch(`${url}/json_rpc`,{method:'POST',headers:{...H,'content-type':'application/json'},body:JSON.stringify({method}),signal:AbortSignal.timeout(4000)});
      return { ok:r.ok, name, preset, action:method };
    }
    const P = TUNE_PRESETS[preset];
    if(!P) return { error:'unknown preset', name };
    const conf = await (await fetch(`${url}/1/config`,{headers:H,signal:AbortSignal.timeout(4000)})).json();
    conf.cpu=conf.cpu||{}; conf.cpu.rx=P.rx; conf.randomx=conf.randomx||{}; conf.randomx.mode=P.mode;
    const put = await fetch(`${url}/1/config`,{method:'PUT',headers:{...H,'content-type':'application/json'},body:JSON.stringify(conf),signal:AbortSignal.timeout(6000)});
    if(node.miner?.local){ try{ const d=await cfg(); d.cpu=d.cpu||{}; d.cpu.rx=P.rx; d.randomx=d.randomx||{}; d.randomx.mode=P.mode; await writeFile(path.join(LAB,'config','xmrig.json'),JSON.stringify(d,null,2)); }catch{} }
    return { ok:(put.status===204||put.ok), name, preset, threads:P.rx.length, mode:P.mode, http:put.status };
  } catch(e){ return { error:String(e), name, preset }; }
}
async function probeHealth(n){
  try {
    const r = await fetch(`${n.url}/health`, { headers:{ Authorization:`Bearer ${HEALTH_TOKEN}` }, signal: AbortSignal.timeout(3000) });
    const d = await r.json(); if (d?.error) throw new Error(d.error);
    return { ...d, name:n.name, kind:n.kind, role:n.role, online:true };
  } catch(e){ return { name:n.name, kind:n.kind, role:n.role, online:false, status:'offline', score:0, advice:'agent unreachable — start health-agent on this node', err:String(e) }; }
}
// per-node manual flags (e.g. Ausra's antivirus flags the miner). config/node-flags.json keyed by node name.
async function nodeFlags(){ try{ return JSON.parse(await readFile(path.join(LAB,'config','node-flags.json'),'utf8')); }catch{ return {}; } }
// MINING-RISK semantics — is mining worth it on this node, or is it burning the machine for pennies?
function miningRisk(node, flags){
  if(node.kind==='vps') return { level:'BLOCKED', score:0, factors:['PoW mining prohibited by VPS ToS — Gridcoin only'], rec:'never PoW-mine here', worth_it:false };
  if(!node.online) return { level:'UNKNOWN', score:0, factors:['node offline — no telemetry'], rec:'start the health-agent', worth_it:null };
  const f=[]; let s=0;
  const role=node.role||'', model=node.model||'';
  const inUse=/daily-driver|own rig/i.test(role);
  if(inUse){ s+=2; f.push('in-use machine — mining competes with real work'); }
  if(/MacBookAir/i.test(model)){ s+=1; f.push('fanless — limited cooling'); }
  const ratio=node.load?.ratio??0;
  if(ratio>1.5){ s+=2; f.push(`oversubscribed (load ${ratio}×)`); } else if(ratio>1){ s+=1; f.push(`busy (load ${ratio}×)`); }
  const mem=node.mem_free_pct;
  if(mem>=0&&mem<20){ s+=2; f.push(`low RAM headroom (${mem}% free)`); }
  if(node.thermal?.warn){ s+=3; f.push('THERMAL throttling — actively overheating'); }
  if(node.throttling){ s+=1; f.push('hashrate being throttled'); }
  const nf=flags[node.name]||flags[node.host]||{};
  if(nf.av_flagged){ s+=2; f.push('antivirus flags the miner (PUA) → it gets quarantined'); }
  const level = s<=1?'SAFE': s<=3?'CAUTION': s<=5?'RISKY':'UNSAFE';
  const rec = level==='SAFE'?'mine freely (governor caps it)'
            : level==='CAUTION'?'gentle only — let the governor manage it'
            : level==='RISKY'?'mine only when truly idle; governor will pause it under load'
            : 'do NOT mine — the wear is not worth pennies';
  const worth_it = !(inUse && level!=='SAFE');   // mining an in-use machine that isn't clearly safe = not worth it
  if(!f.length) f.push('healthy headroom — dedicated-miner-grade');
  return { level, score:s, factors:f, rec, worth_it };
}
async function nodeHealth(){
  const [macs, bo, flags] = await Promise.all([ Promise.all(HEALTH_NODES.map(probeHealth)), boinc().catch(()=>({boxes:[]})), nodeFlags() ]);
  // VPS (linux) health from the BOINC poll we already do — load-ratio only (no thermal on shared VPS)
  const vps = (bo.boxes||[]).filter(b=>b.reachable).map(b=>{
    // VPS are rented crunchers — meant to run hot. Pinned load = working, NOT a lifespan risk.
    // Only flag if thrashing (ratio >3.5) or not actually crunching.
    const ratio = b.nproc ? +(b.load/b.nproc).toFixed(2) : null;
    const crunching = !!b.project;
    let score = 100, advice = 'crunching at full tilt — healthy';
    if (!crunching) { score = 55; advice = 'idle — attach a Gridcoin project'; }
    else if (ratio!=null && ratio>3.5) { score = 60; advice = 'overcommitted — load>3.5×, may thrash'; }
    else if (ratio!=null && ratio>2.6) { score = 82; advice = 'busy — fine for a dedicated cruncher'; }
    const status = score>=80?'good':score>=60?'strain':score>=40?'hot':'critical';
    return { name:b.name, kind:'vps', role:'gridcoin', online:true,
      load:{ l1:b.load, ratio }, ncpu:b.nproc, miner:{ mining:false }, project:b.project,
      score, status, advice, ts:Date.now() };
  });
  const nodes = [...macs, ...vps].map(n=>({ ...n, mining_risk: miningRisk(n, flags) }));
  const live = nodes.filter(n=>n.online);
  const scores = live.map(n=>n.score).filter(s=>typeof s==='number');
  const mesh_score = scores.length ? Math.round(scores.reduce((a,c)=>a+c,0)/scores.length) : 0;
  const worst = live.slice().sort((a,b)=>a.score-b.score)[0] || null;
  const hashrate_total = macs.filter(m=>m.online).reduce((a,m)=>a+(m.miner?.h60s||m.miner?.h10s||0),0);
  const counts = live.reduce((o,n)=>{ o[n.status]=(o[n.status]||0)+1; return o; },{});
  const mesh_status = mesh_score>=80?'good':mesh_score>=60?'strain':mesh_score>=40?'hot':'critical';
  // mesh-wide MINING POSTURE — which nodes are safe to mine, which are burning for pennies
  const mineable = nodes.filter(n=>n.kind==='mac' && n.online);
  const riskCounts = mineable.reduce((o,n)=>{ const l=n.mining_risk?.level||'UNKNOWN'; o[l]=(o[l]||0)+1; return o; },{});
  const unsafe = mineable.filter(n=>['RISKY','UNSAFE'].includes(n.mining_risk?.level));
  const posture = unsafe.length
    ? `${unsafe.map(n=>n.name.split(' ')[0]).join(', ')} at mining risk — ${unsafe[0].mining_risk.rec}`
    : (mineable.length ? 'all mining nodes within safe envelope' : 'no mining nodes reporting');
  return { nodes, mesh:{ score:mesh_score, status:mesh_status, nodes_online:live.length, nodes_total:nodes.length,
    hashrate_total:+hashrate_total.toFixed(0), worst: worst?{name:worst.name,score:worst.score,status:worst.status,advice:worst.advice}:null,
    counts, mining_posture:posture, mining_risk_counts:riskCounts }, ts:Date.now() };
}
// auto-protect governor: status (written by governor.mjs) + on/off toggle (governor reads cfg each loop)
async function governorStatus(){ try{ return JSON.parse(await readFile(path.join(LAB,'logs','governor-state.json'),'utf8')); }catch{ return { enabled:false, status:'not-running', nodes:[], recent:[] }; } }
async function governorToggle(action){
  try{ const p=path.join(LAB,'config','governor.json'); const c=JSON.parse(await readFile(p,'utf8'));
    c.enabled = action==='on' ? true : action==='off' ? false : !c.enabled;
    await writeFile(p, JSON.stringify(c,null,2)); return { ok:true, enabled:c.enabled };
  }catch(e){ return { error:String(e) }; }
}
// ── Thin-air farming command center ───────────────────────────────────────
async function farm(){
  let reg; try{ reg=JSON.parse(await readFile(path.join(LAB,'config','farm-targets.json'),'utf8')); }catch{ reg={targets:[]}; }
  let ov={}; try{ ov=JSON.parse(await readFile(path.join(LAB,'config','farm-status.json'),'utf8')); }catch{}
  let pb={}; try{ pb=(JSON.parse(await readFile(path.join(LAB,'config','farm-playbooks.json'),'utf8'))||{}).playbooks||{}; }catch{}
  const effMul={low:1,med:0.7,high:0.5}, sybMul={low:1,med:0.8,high:0.6};
  const targets=(reg.targets||[]).map(t=>{
    const status=ov[t.id]||t.status||'planned';
    const evMid=((+t.est_low||0)+(+t.est_high||0))/2;
    const annual=t.recurring? evMid*12 : evMid;            // annualize recurring DePIN for ranking
    const priority=+(annual*(effMul[t.effort]??0.7)*(sybMul[t.sybil]??0.8)*(t.mesh?1.15:1)).toFixed(0);
    const play=pb[t.id]||{};
    return {...t, status, ev_mid:+evMid.toFixed(0), priority, steps:play.steps||null, window:play.window||null};
  }).sort((a,b)=>b.priority-a.priority);
  const byCat={}; for(const t of targets){ (byCat[t.cat]=byCat[t.cat]||[]).push(t); }
  const active=targets.filter(t=>['active','configure'].includes(t.status)).length;
  const claimed=targets.filter(t=>t.status==='claimed').length;
  const potLow=targets.reduce((a,t)=>a+(t.recurring?(+t.est_low||0)*12:(+t.est_low||0)),0);
  const potHigh=targets.reduce((a,t)=>a+(t.recurring?(+t.est_high||0)*12:(+t.est_high||0)),0);
  const next=targets.find(t=>!['active','claimed','configure'].includes(t.status));
  return {targets, byCat, count:targets.length, active, claimed,
    potential_low:Math.round(potLow), potential_high:Math.round(potHigh),
    next: next?{id:next.id,name:next.name,note:next.note}:null, strategy:reg._strategy};
}
async function farmStatus(id,status){
  if(!id) return {error:'no id'};
  try{ const p=path.join(LAB,'config','farm-status.json'); let o={}; try{o=JSON.parse(await readFile(p,'utf8'));}catch{} o[id]=status; await writeFile(p,JSON.stringify(o,null,2)); return {ok:true,id,status}; }
  catch(e){ return {error:String(e)}; }
}
// ── Earnings ledger rollups (day / week / month / intraday) ───────────────
async function ledger(){
  let rows=[]; try{ rows=(await readFile(path.join(LAB,'data','ledger.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean); }catch{}
  if(!rows.length) return { empty:true, series:[], today:{}, week:{}, month:{}, recent:[] };
  // last snapshot per day = that day's cumulative
  const byDay={}; for(const r of rows){ byDay[r.date]=r; }
  const days=Object.keys(byDay).sort();
  const series=days.map((d,i)=>{ const cur=byDay[d], prev=i>0?byDay[days[i-1]]:null;
    const earned=prev? Math.max(0, +((cur.mining_earned_usd||0)-(prev.mining_earned_usd||0)).toFixed(4)) : 0;
    return { date:d, cumulative:+(cur.mining_earned_usd||0), earned, hashrate:cur.hashrate||0, rate:cur.rate_usd_day||0, held:cur.held_usd||0, mesh:cur.mesh_score, income_day:cur.income_day||0 };
  });
  const last=series[series.length-1];
  const sumN=n=>+(series.slice(-n).reduce((a,s)=>a+s.earned,0)).toFixed(4);
  const avgRate=n=>{ const w=series.slice(-n); return w.length? +(w.reduce((a,s)=>a+s.rate,0)/w.length).toFixed(4):0; };
  return { empty:false, day_count:series.length, series,
    cumulative:last.cumulative, held:last.held,
    today:{ earned:last.earned, rate:last.rate, hashrate:last.hashrate },
    week:{ earned:sumN(7), avg_rate:avgRate(7) },
    month:{ earned:sumN(30), avg_rate:avgRate(30) },
    recent: rows.slice(-48) };   // intraday raw snapshots
}
// ── Compounding model + Monte-Carlo stress test (rags-to-riches path) ─────
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
async function compound(qs){
  let c={}; try{ c=JSON.parse(await readFile(path.join(LAB,'config','compound-config.json'),'utf8')); }catch{}
  const cfg={ start_capital:100, horizon_days:1825, free_daily_low:0.2, free_daily_high:0.6, yield_apy:0.20, yield_min_capital:500, airdrop_hit_prob:0.15, airdrop_value_haircut:0.5, mc_paths:3000, milestones:[1000,10000,100000,1000000], ...c };
  // allow live override of key knobs via query (?yield_apy=&airdrop_hit_prob=&reinvest=)
  for(const k of ['yield_apy','airdrop_hit_prob','free_daily_low','free_daily_high','horizon_days']){ const v=qs?.get?.(k); if(v!=null&&v!=='') cfg[k]=+v; }
  // airdrop lumps = non-recurring farm targets with upside
  let lumps=[]; try{ const reg=JSON.parse(await readFile(path.join(LAB,'config','farm-targets.json'),'utf8'));
    lumps=(reg.targets||[]).filter(t=>!t.recurring && (+t.est_high||0)>0).map(t=>({lo:+t.est_low||0, hi:+t.est_high||0})); }catch{}
  const dailyYield=Math.pow(1+cfg.yield_apy,1/365)-1;
  const H=Math.round(cfg.horizon_days), N=Math.round(cfg.mc_paths);
  const sim=(rnd)=>{
    let cap=cfg.start_capital; const ms={}; cfg.milestones.forEach(m=>ms[m]=null);
    for(let day=1; day<=H; day++){
      cap += cfg.free_daily_low + rnd()*(cfg.free_daily_high-cfg.free_daily_low);     // free streams drip
      if(cap>=cfg.yield_min_capital) cap += cap*dailyYield;                            // deployed capital compounds
      for(const L of lumps){ if(rnd() < cfg.airdrop_hit_prob/365){ cap += (L.lo + rnd()*(L.hi-L.lo))*cfg.airdrop_value_haircut; } } // fat-tail airdrops
      for(const m of cfg.milestones){ if(ms[m]==null && cap>=m) ms[m]=day; }
    }
    return { cap, ms };
  };
  const finals=[], msDays={}; cfg.milestones.forEach(m=>msDays[m]=[]); let reach={}; cfg.milestones.forEach(m=>reach[m]=0);
  for(let i=0;i<N;i++){ const r=sim(mulberry32(0x9e3779b9 ^ i)); finals.push(r.cap);
    for(const m of cfg.milestones){ if(r.ms[m]!=null){ reach[m]++; msDays[m].push(r.ms[m]); } } }
  finals.sort((a,b)=>a-b);
  const pct=p=>finals[Math.min(finals.length-1, Math.floor(p*finals.length))];
  const medDay=m=>{ const a=msDays[m].slice().sort((x,y)=>x-y); return a.length? a[Math.floor(a.length/2)] : null; };
  const milestones=cfg.milestones.map(m=>({ target:m, prob_reach:+(reach[m]/N).toFixed(3),
    median_days: medDay(m), median_years: medDay(m)? +(medDay(m)/365).toFixed(2):null }));
  return { horizon_days:H, paths:N, lumps:lumps.length, assumptions:{ yield_apy:cfg.yield_apy, airdrop_hit_prob:cfg.airdrop_hit_prob, free_daily:[cfg.free_daily_low,cfg.free_daily_high] },
    outcome_at_horizon:{ p10:+pct(0.1).toFixed(2), p50:+pct(0.5).toFixed(2), p90:+pct(0.9).toFixed(2), p99:+pct(0.99).toFixed(2) },
    milestones, honest:'Most paths stay small; the upside is the airdrop fat-tail + compounding. This is a DISTRIBUTION, not a promise.' };
}
// ── Eligibility tracker (KEYLESS, public addresses only) ──────────────────
const CHAIN_RPC={ eth:'https://eth.llamarpc.com', base:'https://mainnet.base.org', arbitrum:'https://arb1.arbitrum.io/rpc', optimism:'https://mainnet.optimism.io', polygon:'https://polygon-rpc.com' };
async function evmRpc(url, method, params){ try{ const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(6000)}); const j=await r.json(); return j.result; }catch{ return null; } }
async function eligibility(){
  let cfg={wallets:[]}; try{ cfg=JSON.parse(await readFile(path.join(LAB,'config','wallets-watch.json'),'utf8')); }catch{}
  const wallets=(cfg.wallets||[]).filter(w=>w.address && /^0x[0-9a-fA-F]{40}$/.test(w.address));
  if(!wallets.length) return { ready:false, msg:'Add PUBLIC receive addresses to config/wallets-watch.json (never keys) to track onchain activity.', wallets:[] };
  const out=await Promise.all(wallets.map(async w=>{
    const rpc=CHAIN_RPC[w.chain]||CHAIN_RPC.eth;
    const [nonce,bal]=await Promise.all([ evmRpc(rpc,'eth_getTransactionCount',[w.address,'latest']), evmRpc(rpc,'eth_getBalance',[w.address,'latest']) ]);
    const txCount=nonce!=null?parseInt(nonce,16):null;
    const nativeBal=bal!=null?+(parseInt(bal,16)/1e18).toFixed(5):null;
    return { label:w.label, chain:w.chain, address:w.address, tx_count:txCount, native_balance:nativeBal, active:(txCount||0)>0 };
  }));
  return { ready:true, wallets:out, note:'tx_count = onchain activity (airdrop-eligibility proxy). KEYLESS public data only.' };
}
// ── Edge mechanism matrix (fringe/arb/MEV/fee-capture) ────────────────────
async function edges(){
  let reg; try{ reg=JSON.parse(await readFile(path.join(LAB,'config','edge-mechanisms.json'),'utf8')); }catch{ reg={mechanisms:[]}; }
  const bS={yes:1,partial:0.5,no:0.15}, lS={legal:1,gray:0.4,AVOID:0}, cS={none:1,low:0.85,med:0.6,high:0.3};
  const isOurs=s=>/omnione|mesh|farm|LIVE/i.test(s||'');
  const m=(reg.mechanisms||[]).map(x=>{
    const ours=isOurs(x.stack);
    const score=Math.round(100*(bS[x.build]??0.3)*(lS[x.legal]??0.3)*(0.6+0.4*(cS[x.cap]??0.5))*(ours?1.15:1));
    return {...x, ours, score};
  }).sort((a,b)=>b.score-a.score);
  const byCat={}; for(const x of m){ (byCat[x.cat]=byCat[x.cat]||[]).push(x); }
  return {mechanisms:m, byCat, count:m.length,
    buildable:m.filter(x=>x.build==='yes').length,
    ours:m.filter(x=>x.ours).length,
    avoid:m.filter(x=>x.legal==='AVOID').length,
    top:m.slice(0,6).map(x=>({id:x.id,name:x.name,score:x.score}))};
}
// ── Opportunity Engine: real DeFi yield (DefiLlama) + cross/triangular arb (public tickers) ──
// Keyless. RANKS + TRACKS; the operator signs every deposit/trade. Nothing here moves money.
async function oppCfg(){ try{ return JSON.parse(await readFile(path.join(LAB,'config','opportunity-config.json'),'utf8')); }catch{ return null; } }
async function gjT(u,ms=8000){ try{ const r=await fetch(u,{signal:AbortSignal.timeout(ms),headers:{'user-agent':'mesh-opp'}}); return await r.json(); }catch{ return null; } }
// persistence: how many recent scanner snapshots a pool stayed in the top list (forward-is-backward for yield)
async function poolPersistence(){
  try{ const c=await oppCfg(); const raw=await readFile(path.join(LAB,c.persistence.snapshot_file),'utf8');
    const lines=raw.trim().split('\n').slice(-c.persistence.trust_full_after_snapshots); const seen={};
    for(const ln of lines){ try{ const s=JSON.parse(ln); for(const p of (s.top_pools||[])) seen[p]=(seen[p]||0)+1; }catch{} }
    return {map:seen, max:c.persistence.trust_full_after_snapshots};
  }catch{ return {map:{},max:12}; }
}
let _yields={t:0,d:null};
async function yields(){
  const c=await oppCfg(); if(!c) return {error:'no opportunity-config.json'};
  if(Date.now()-_yields.t < (c.refresh_yields_sec*1000) && _yields.d) return _yields.d;
  const Y=c.yields; const j=await gjT(Y.source,12000); const pools=(j&&j.data)||[];
  if(!pools.length) return { error:'DefiLlama unreachable', top:[], base:[] };
  const cheap=new Set(Y.cheap_chains), safe=new Set(Y.safe_projects), W=Y.weights;
  const persist=await poolPersistence();
  const scored=pools.filter(p=> p.tvlUsd>=Y.min_tvl_usd && p.apy!=null && p.apy>=Y.min_apy ).map(p=>{
    const apy=p.apy||0, base=p.apyBase!=null?p.apyBase:apy, reward=p.apyReward||0;
    const organic = apy>0 ? Math.max(0,Math.min(1, base/apy)) : 0;
    const tvl = Math.max(0, Math.min(1, Math.log10(Math.max(1,p.tvlUsd)/1e6)/2.5 ));
    const safety = Math.max(0,Math.min(1, (safe.has(p.project)?0.7:0.2) + (p.stablecoin?0.3:0) + (p.ilRisk==='no'?0:-0.1) ));
    const chain_fit = cheap.has(p.chain)?1 : (Y.expensive_chains.includes(p.chain)?0.25:0.6);
    const pred = p.predictions ? (p.predictions.predictedClass==='Stable/Up'?1 : p.predictions.predictedClass==='Down'?0.2 : 0.6) : 0.6;
    const trustCap = apy>Y.max_apy_trust ? 0.4 : 1;
    const seen=persist.map[p.pool]||0, pFrac=Math.min(1,seen/persist.max);
    const raw = 100*( W.organic*organic + W.tvl*tvl + W.safety*safety + W.chain_fit*chain_fit + W.prediction*pred );
    const score = Math.round( trustCap * raw * (0.6 + 0.4*pFrac) ); // young pools faded until they persist
    return { project:p.project, symbol:p.symbol, chain:p.chain, apy:+apy.toFixed(2), apyBase:+(base||0).toFixed(2),
      apyReward:+reward.toFixed(2), tvlUsd:Math.round(p.tvlUsd), stablecoin:!!p.stablecoin, ilRisk:p.ilRisk||'unknown',
      organic:+organic.toFixed(2), persistence:seen, score, pool:p.pool };
  }).sort((a,b)=>b.score-a.score);
  const baseList=scored.filter(x=>x.stablecoin && cheap.has(x.chain) && safe.has(x.project)).slice(0,8);
  const d={ count:scored.length, capital_usd:c.capital_usd, top:scored.slice(0,25), base:baseList,
    note:'Organic = fraction of APY from real fees (not decaying emissions). For $100 the BASE list (single-sided stable lending · cheap chains · blue-chip) is the safe compounding layer. Persistence = snapshots a pool held in the top list (trust grows with it). Operator signs the deposit.',
    honest:c.honest };
  _yields={t:Date.now(),d}; return d;
}
let _spreads={t:0,d:null};
async function spreads(){
  const c=await oppCfg(); if(!c) return {error:'no opportunity-config.json'};
  if(Date.now()-_spreads.t < (c.refresh_spreads_sec*1000) && _spreads.d) return _spreads.d;
  const S=c.spreads, fee=S.taker_fee_bps;
  const bAll=await gjT('https://api.binance.com/api/v3/ticker/bookTicker',8000);
  const bmap={}; if(Array.isArray(bAll)) for(const r of bAll) bmap[r.symbol]={bid:+r.bidPrice,ask:+r.askPrice};
  const ksym={BTC:'XBT',DOGE:'XDG'};
  const kr=await gjT(`https://api.kraken.com/0/public/Ticker?pair=${S.pairs.map(p=>(ksym[p]||p)+'USDT').join(',')}`,8000);
  const kres=(kr&&kr.result)||{};
  const krGet=p=>{ const tag=ksym[p]||p; const key=Object.keys(kres).find(k=>k.startsWith(tag)&&k.endsWith('USDT')); return key?{bid:+kres[key].b[0],ask:+kres[key].a[0]}:null; };
  const cross=S.pairs.map(p=>{
    const b=bmap[p+'USDT'], k=krGet(p); if(!b||!k) return null;
    const g1=(b.bid-k.ask)/k.ask*1e4, g2=(k.bid-b.ask)/b.ask*1e4;
    const dir = g1>=g2 ? {buy:'kraken',sell:'binance',gross:g1} : {buy:'binance',sell:'kraken',gross:g2};
    const feeTot = fee.binance + fee.kraken + S.withdrawal_haircut_bps;
    const net = dir.gross - feeTot;
    return { pair:p, buy:dir.buy, sell:dir.sell, gross_bps:+dir.gross.toFixed(1), fee_bps:feeTot, net_bps:+net.toFixed(1), profitable: net>=S.min_net_spread_bps };
  }).filter(Boolean).sort((a,b)=>b.net_bps-a.net_bps);
  // rate(from→to): buy `to` with `from` via pair to+from (pay ask → 1/ask), or sell `from` for `to` via from+to (hit bid)
  const rate=(from,to)=>{ if(bmap[to+from]) return 1/bmap[to+from].ask; if(bmap[from+to]) return bmap[from+to].bid; return null; };
  const cycleProduct=(seq)=>{ let prod=1; for(let i=0;i<seq.length;i++){ const r=rate(seq[i], seq[(i+1)%seq.length]); if(r==null) return null; prod*=r; } return prod; };
  const tri=(S.triangular.cycles||[]).map(([a,b,cc])=>{
    const fwd=cycleProduct([a,b,cc]), rev=cycleProduct([a,cc,b]);
    if(fwd==null&&rev==null) return null;
    const best=Math.max(fwd??0,rev??0), gross=(best-1)*1e4, net=gross-3*fee.binance;
    return { cycle:`${a}·${b}·${cc}`, dir: (fwd??-9)>=(rev??-9)?`${a}→${b}→${cc}`:`${a}→${cc}→${b}`, gross_bps:+gross.toFixed(2), net_bps:+net.toFixed(2), profitable: net>=S.min_net_spread_bps };
  }).filter(Boolean).sort((a,b)=>b.net_bps-a.net_bps);
  const any=cross.some(x=>x.profitable)||tri.some(x=>x.profitable);
  const d={ ts:Date.now(), cross, triangular:tri, any_profitable:any,
    verdict: any?'A spread cleared fees on this poll — almost always STALE by the time you act (HFT bots close these in ms). Verify live before trusting it.':'No spread clears fees — the honest, usual result. Cross-exchange needs balances pre-positioned on both venues; triangular is owned by ms-latency bots.',
    note:'Cross-exchange nets BOTH taker fees + a withdrawal haircut. Operator executes; this only surfaces the spread.' };
  _spreads={t:Date.now(),d}; return d;
}
// unified actionable digest: the best safe yield + best arb + which formulation it maps to + what to do now
async function opportunities(){
  const [y,s]=await Promise.all([yields(),spreads()]);
  const bestYield=(y.base&&y.base[0])||(y.top&&y.top[0])||null;
  const bestArb=[...(s.cross||[]),...(s.triangular||[])].sort((a,b)=>b.net_bps-a.net_bps)[0]||null;
  const actions=[];
  if(bestYield) actions.push({ kind:'yield', formulation:'F-COMPOUND', priority: bestYield.persistence>=6?'ready':'watch',
    text:`Park idle stables in ${bestYield.project} ${bestYield.symbol} on ${bestYield.chain} — ${bestYield.apy}% APY (${Math.round(bestYield.organic*100)}% organic, persistence ${bestYield.persistence}). ${bestYield.persistence<6?'Let it persist a few more snapshots before sizing in.':'Persistent — safe base layer.'} Operator signs the deposit.` });
  if(bestArb && bestArb.profitable) actions.push({ kind:'arb', formulation:'F-ARB', priority:'verify-live', text:`Spread flagged net +${bestArb.net_bps}bps (${bestArb.pair||bestArb.cycle}). Likely stale on a REST poll — verify live before acting.` });
  else actions.push({ kind:'arb', formulation:'F-ARB', priority:'none', text:'No arb clears fees right now (the honest, usual state).' });
  return { best_yield:bestYield, best_arb:bestArb, actions, yields_count:y.count||0,
    note:'Digest of the live keyless scanners. The operator executes every money move; the engine ranks, tracks persistence, and tells you when an edge is real vs a mirage.' };
}

// world-pulse: keyless market sentiment (the operator's "humanity is a pulse" signal)
let _pulse={t:0,d:null};
async function worldPulse(){
  if(Date.now()-_pulse.t<300000 && _pulse.d) return _pulse.d;
  const [fng,glob]=await Promise.all([ gjT('https://api.alternative.me/fng/?limit=1',6000), gjT('https://api.coingecko.com/api/v3/global',6000) ]);
  const f=fng&&fng.data&&fng.data[0], g=glob&&glob.data;
  const d={ fng: f?+f.value:null, fng_label: f?f.value_classification:null,
    mcap_24h: g?+(g.market_cap_change_percentage_24h_usd||0).toFixed(2):null,
    btc_dom: g?+(g.market_cap_percentage?.btc||0).toFixed(1):null,
    regime: f? (+f.value<=25?'extreme-fear (contrarian accumulate)':+f.value<=45?'fear':+f.value>=75?'extreme-greed (de-risk)':+f.value>=55?'greed':'neutral') : null };
  _pulse={t:Date.now(),d}; return d;
}
// formulation tester: run each of the 100 income-edge formulations against LIVE keyless data, honest status.
// RUNNING = our infra is live + accumulating · TESTABLE = keyless data evaluates it now · OPERATOR = needs a signup/deposit/claim first.
async function formulationTest(){
  let F=[]; try{ F=(JSON.parse(await readFile(path.join(LAB,'config','income-edge-formulations.json'),'utf8')).formulations)||[]; }catch{}
  const [opp,comp,hl,led,fm,pulse]=await Promise.all([
    opportunities().catch(()=>({})), compound(new URLSearchParams()).catch(()=>({})),
    nodeHealth().catch(()=>({})), ledger().catch(()=>({})), farm().catch(()=>({})), worldPulse().catch(()=>({})) ]);
  const nodes=hl?.mesh?.nodes_online??0, mesh=hl?.mesh?.score??null;
  const days=led?.day_count??0, cum=led?.cumulative??0, active=fm?.active??0;
  const by=led?.base_best, bestY=opp?.best_yield, arb=opp?.best_arb;
  const mP=t=>{ const m=(comp?.milestones||[]).find(x=>x.target===t); return m?Math.round(m.prob_reach*100):null; };
  const ev=(cat)=>{
    switch(cat){
      case 'compound': return {status:'RUNNING', evidence:`MC stress: $1k ${mP(1000)}% · $10k ${mP(10000)}% · $100k ${mP(100000)}% · $1M ${mP(1000000)}%`, action:'reinvest every stream; the engine recomputes the distribution nightly'};
      case 'arb': return {status:'TESTABLE', evidence: arb?`best net ${arb.net_bps}bps — ${arb.profitable?'⚠ verify live':'fees eat it (honest)'}`:'scanning', action: arb&&arb.profitable?'verify on live book before acting':'monitor; nothing to do (usual state)'};
      case 'depin': return {status: nodes>0?'RUNNING':'OPERATOR', evidence:`${nodes} mesh nodes online (linear-earner surface)`, action: nodes>0?'install Honeygain/Grass/Pawns on each node — operator signs up':'bring nodes online first'};
      case 'node-edge': return {status: nodes>0?'RUNNING':'OPERATOR', evidence:`mesh score ${mesh} · ${nodes} nodes · governor protecting hardware`, action:'tune per-node intensity on the Vitals page'};
      case 'forward-backward': return {status:'RUNNING', evidence:`ledger ${days}d (cum $${(cum||0).toFixed(3)}) · scanner recording persistence`, action:'let the loop accumulate — trust grows with snapshots'};
      case 'world-pulse': return {status:'TESTABLE', evidence: pulse?.fng!=null?`F&G ${pulse.fng} (${pulse.fng_label}) · mcap ${pulse.mcap_24h}% · BTC dom ${pulse.btc_dom}% → ${pulse.regime}`:'pulse loading', action:'tilt accumulation into extreme-fear, de-risk into extreme-greed'};
      case 'portfolio': return {status:'TESTABLE', evidence:`${active} farm streams + mining + yield — allocate across them`, action:'spread the next dollar across uncorrelated streams (1/N base)'};
      case 'biproduct': return {status:'RUNNING', evidence:`mining live (cum $${(cum||0).toFixed(3)}) + ${active} farm streams`, action:'each idle resource = a bi-product earner; keep them all on'};
      case 'airdrop-rhythm': return {status:'OPERATOR', evidence:'eligibility tracker keyless-ready (add public addresses)', action:'add PUBLIC receive addresses to wallets-watch.json; operator does the onchain activity'};
      case 'quest': return {status:'OPERATOR', evidence:'quest/testnet tasks need an account', action:'operator completes the quest; engine tracks the snapshot window'};
      case 'network': return {status:'OPERATOR', evidence:'referral/network edges need an account', action:'operator shares referral; engine tracks'};
      default: return {status:'OPERATOR', evidence:'needs operator action to activate', action:'see the formulation thesis'};
    }
  };
  const out=F.map(f=>({ id:f.id, name:f.name, cat:f.cat, cap:f.cap, mesh:f.mesh, thesis:f.thesis, test:f.test, ...ev(f.cat) }));
  const counts=out.reduce((a,f)=>{ a[f.status]=(a[f.status]||0)+1; return a; },{});
  return { count:out.length, counts, pulse, formulations:out,
    note:`${counts.RUNNING||0} running, ${counts.TESTABLE||0} testable, ${counts.OPERATOR||0} need setup.` };
}

// FREE / thin-air streams: zero-capital idle-resource income + the airdrop/PGF upside, mesh-stacked honestly.
async function freeStreams(){
  let cfg={streams:[]}; try{ cfg=JSON.parse(await readFile(path.join(LAB,'config','free-streams.json'),'utf8')); }catch{}
  let deployed={}; try{ deployed=JSON.parse(await readFile(path.join(LAB,'config','free-streams-state.json'),'utf8')); }catch{}
  const hl=await nodeHealth().catch(()=>({}));
  const macs=(hl?.nodes||[]).filter(n=> n.kind!=='vps' );
  const macOnline=macs.filter(n=> n.online || n.reachable || (n.status && n.status!=='offline') ).length;
  const dev=Math.max(1, macOnline || (hl?.mesh?.nodes_online||1));
  const perDevice=k=> k==='bandwidth'||k==='bandwidth-airdrop'||k==='compute';
  const streams=(cfg.streams||[]).map(s=>{
    const [lo,hi]=s.usd_day_per_device||[0,0]; const mult=perDevice(s.kind)?dev:1;
    const live = s.automatable==='running' || !!deployed[s.id];
    return { ...s, devices:mult, est_day_low:+(lo*mult).toFixed(2), est_day_high:+(hi*mult).toFixed(2),
      live, action: live?'running':({ 'deploy':'one command (your creds)','deploy-emulated':'one command (your creds, emulated)','operator-vet':'vet the client, then run','operator-signup':'sign up + run','ai-assist-draft':'I draft it, you submit','ai-assist-audit':'I help audit, you submit' }[s.automatable]||'sign up') };
  });
  const sum=(f)=>streams.filter(f).reduce((a,s)=>[a[0]+s.est_day_low,a[1]+s.est_day_high],[0,0]).map(x=>+x.toFixed(2));
  const drip=sum(s=>['bandwidth','bandwidth-airdrop','compute','do-anyway'].includes(s.kind));
  const live=sum(s=>s.live);
  const groups={
    running: streams.filter(s=>s.live),
    one_command: streams.filter(s=>!s.live && /deploy/.test(s.automatable)),
    airdrop_nodes: streams.filter(s=>!s.live && s.automatable==='operator-vet'),
    do_anyway: streams.filter(s=>!s.live && s.automatable==='operator-signup'),
    paid_for_work: streams.filter(s=>/ai-assist/.test(s.automatable)),
  };
  const airdropUpside=streams.filter(s=>/airdrop/.test(s.kind)||/grant|bug|token/i.test(s.airdrop||'')).map(s=>s.name);
  return { mesh_macs:dev, streams,
    daily_drip_usd:{ live, full_potential:drip },
    groups, airdrop_upside:airdropUpside,
    framing:`${dev} device${dev===1?'':'s'}, ${streams.filter(s=>s.live).length} running. Airdrop upside from early-node tokens + grants/bounties for existing work.`,
    honest:`Bandwidth/compute streams: ~$0.50-1.50/day across ${dev} Mac${dev===1?'':'s'}. Real upside: airdrop tokens + grants/bounties (100-1000x the bandwidth pennies).` };
}

// KNOWLEDGE → MONEY engine: EV-rank zero-capital build/skill income; surface what's PASSIVE + what AI can do now.
function kcParseUsd(s){ let m=0; for(const x of ((s||'').match(/\$\s?[\d.,]+\s*[kKmM]?\+?/g)||[])){ let n=parseFloat(x.replace(/[^\d.]/g,''))||0; if(/[kK]/.test(x))n*=1e3; if(/[mM]/.test(x))n*=1e6; m=Math.max(m,n);} return m; }
function kcScore(t){
  const usd=kcParseUsd(t.est_value)||50;
  const valW=Math.max(0,Math.min(1, Math.log10(usd)/5));                 // $1→0 … $100k→1
  const prob={ 'high':1,'low-med':0.45,'med':0.6,'low':0.3 }[(String(t.prob||'').match(/high|low-med|med|low/)||['med'])[0]] ?? 0.55;
  const eff = /once/.test(t.effort)?1 : /apply|proposal|issue|work/.test(t.effort)?0.72 : /build|audit|sprint|weekend/.test(t.effort)?0.55 : 0.7;
  const rec = /weekly|passive|monthly|continuous/.test(t.recurring)?1 : /round|epoch|program/.test(t.recurring)?0.6 : 0.78;
  const auto=t.automatic?0.25:0, ai=t.ai_leverage?0.15:0;
  return Math.round( 100 * (0.45*valW + 0.30*prob + 0.25*rec) * eff * (1+auto+ai) );
}
async function knowledgeCapital(){
  let cfg={targets:[]}; try{ cfg=JSON.parse(await readFile(path.join(LAB,'config','knowledge-capital.json'),'utf8')); }catch{}
  let state={}; try{ state=JSON.parse(await readFile(path.join(LAB,'config','knowledge-capital-state.json'),'utf8')); }catch{}
  const T=(cfg.targets||[]).map(t=>({ ...t, score:kcScore(t), max_usd:kcParseUsd(t.est_value)||null, status:state[t.id]||'open' })).sort((a,b)=>b.score-a.score);
  const byCat={}; for(const t of T){ (byCat[t.category]=byCat[t.category]||[]).push(t); }
  const passive=T.filter(t=>t.automatic).map(t=>({ id:t.id, name:t.name, est_value:t.est_value, url:t.url, requires:t.requires }));
  const ai_now=T.filter(t=>/draft|solve|audit|build|write|raise|identif/i.test(t.ai_leverage||'')).map(t=>({ id:t.id, name:t.name, does:t.ai_leverage }));
  const catLabel={ 'passive-builder':'Passive (pays for building you already do)','grants':'Grants (fund work already done)','bounties':'Bounties (solve → paid)','audit-contests':'Audit contests (skill, no capital)','hackathons':'Hackathons (build → win, online)','ai-work':'AI expert work ($/hr knowledge)','content':'Content + ambassador' };
  return { count:T.length, targets:T, byCat, catLabel, passive, ai_now, top:T.slice(0,8),
    note:'EV-ranked: value × probability × recurrence × effort, bonus for AUTOMATIC (pays passively) + AI-LEVERAGE (the agent does the work). Operator holds the GitHub/wallet/identity, submits + claims; the agent drafts/audits/solves/builds. Status persists per target.',
    honest:cfg.honest };
}

// FRINGE lab: the 100 zero-capital concepts + the Monte-Carlo stack-test result (tools/fringe-mc.mjs)
async function fringe(){
  let cat={concepts:[]}; try{ cat=JSON.parse(await readFile(path.join(LAB,'config','fringe-100.json'),'utf8')); }catch{}
  let mc=null; try{ mc=JSON.parse(await readFile(path.join(LAB,'data','fringe-mc.json'),'utf8')); }catch{}
  const plays=(cat.concepts||[]).filter(c=>c.cat!=='foundation');
  const byCat={}; for(const c of plays){ (byCat[c.cat]=byCat[c.cat]||[]).push(c.name); }
  return { count:plays.length, byCat, concepts:cat.concepts||[], mc,
    note:'100 zero-capital creation/fringe concepts + a Monte-Carlo STACK test (combinations under a time budget). Honest: tail-driven — most months modest, EV lives in the rare big hit. The MC shows distributions + what dominates, not promises.' };
}

// THE PLAYBOOK — sequenced synthesis of every engine into an ordered, trackable action plan.
async function playbook(){
  let cfg={phases:[],steps:[]}; try{ cfg=JSON.parse(await readFile(path.join(LAB,'config','playbook.json'),'utf8')); }catch{}
  let state={}; try{ state=JSON.parse(await readFile(path.join(LAB,'config','playbook-state.json'),'utf8')); }catch{}
  const steps=(cfg.steps||[]).map(s=>({ ...s, status: state[s.id]||s.status||'todo' }));
  const byPhase=(cfg.phases||[]).map(p=>({ ...p, steps: steps.filter(s=>s.phase===p.id) }));
  const done=steps.filter(s=>s.status==='done').length, doing=steps.filter(s=>s.status==='doing').length;
  const next=steps.find(s=>s.status==='todo');
  return { phases:byPhase, total:steps.length, done, doing, pct:Math.round(done/Math.max(1,steps.length)*100),
    next: next?{id:next.id,name:next.name,who:next.who}:null, honest:cfg.honest };
}

// daily content artifact (the autonomous report-generator's output) — publish-ready
async function report(){
  let md='', meta=null;
  try{ md=await readFile(path.join(LAB,'reports','latest.md'),'utf8'); }catch{}
  try{ meta=JSON.parse(await readFile(path.join(LAB,'reports','latest.json'),'utf8')); }catch{}
  return { ok:!!md, meta, markdown:md, note:'Daily brief, auto-generated. Publish to newsletter, Farcaster, Mirror, or X.' };
}

// STRATEGIST — the thinking layer. Ranks every avenue by VALUE-PER-ENERGY (money/joule·effort) and
// outputs the optimal energy→value→money workflow. Embodies the law: route energy to the highest-value
// transform (intelligence/creation), not the lowest (hash). See memory energy-transformation-thesis.
async function strategist(){
  const [kc, fr, opp, comp, led, free] = await Promise.all([
    knowledgeCapital().catch(()=>({})), fringe().catch(()=>({})), opportunities().catch(()=>({})),
    compound(new URLSearchParams()).catch(()=>({})), ledger().catch(()=>({})), freeStreams().catch(()=>({})) ]);
  const dom = (fr?.mc?.dominant||[]).slice(0,6).map(d=>d.name);
  const passiveN = kc?.passive?.length||0, aiNow = kc?.ai_now?.length||0;
  const bestYield = opp?.best_yield ? `${opp.best_yield.project} ${opp.best_yield.apy}%` : null;
  const mined = led?.cumulative||0;
  // energy ledger — every transform ranked by value-per-energy (honest). ratio is a relative score 0-100.
  const energy_ledger = [
    { transform:'Audits, content, grants', ratio:95, autonomy:'machine produces, you submit' },
    { transform:'Onchain apps + contracts', ratio:78, autonomy:'machine builds, you deploy' },
    { transform:'Builder rewards (Base, Sponsors, tea.xyz)', ratio:70, autonomy:'set up once, then automatic' },
    { transform:'Airdrops + points', ratio:55, autonomy:'mesh runs nodes, you sign claims' },
    { transform:'DeFi yield', ratio:45, autonomy:'you deposit once', note: bestYield||null },
    { transform:'Bandwidth DePIN', ratio:25, autonomy:'mesh runs it' },
    { transform:'Mining (PoW)', ratio:8, autonomy:'fully autonomous', note:`$${mined.toFixed(3)} cumulative` },
  ];
  return {
    energy_ledger,
    optimal_workflow:[
      { step:1, name:'Set up identity (one-time)', who:'operator', detail:'Basename + public repo + Farcaster', autonomous:false },
      { step:2, name:'Machine produces value', who:'machine', detail:`daily brief live, ${aiNow} drafts ready`, autonomous:true },
      { step:3, name:'Enable passive income', who:'operator', detail:'Base Builder Rewards + Sponsors', autonomous:false },
      { step:4, name:'Submit + publish', who:'operator', detail:'grant apps, audit findings, content — you sign', autonomous:false },
      { step:5, name:'Reinvest + re-rank', who:'machine', detail:'orchestrator re-ranks avenues each cycle', autonomous:true },
    ],
    now: passiveN>=0 ? 'Set up the 4 foundations in EXECUTION-PACKET.md to unlock passive income.' : 'engines warming up',
    honest:`${passiveN} passive streams available. Mining earns $${mined.toFixed(3)} total — deprioritized.`
  };
}

// REVENUE & ETA — the honest consolidated truth. Realized (actual money) vs projected (if monetized).
async function revenue(){
  const [led, ov, comp] = await Promise.all([ ledger().catch(()=>({})), overview().catch(()=>({})), compound(new URLSearchParams()).catch(()=>({})) ]);
  const realized = +(led?.cumulative||0);
  const rate = +(ov?.totals?.fleet_usd_day ?? ov?.totals?.usd_per_day ?? 0);
  const hr = +(ov?.totals?.xmr_hashrate||0);
  const etaDays = (target)=> rate>0 ? Math.round((target-realized)/rate) : null;
  const yr = (d)=> d!=null ? +(d/365).toFixed(1) : null;
  const ms = (t)=>{ const m=(comp?.milestones||[]).find(x=>x.target===t); return m?{prob:Math.round(m.prob_reach*100), years:m.median_years}:null; };
  return {
    realized: { total:+realized.toFixed(4), source:'mining',
      today:+((led?.today?.earned)||0).toFixed(4), week:+((led?.week?.earned)||0).toFixed(4), day_count:led?.day_count||0 },
    rate: { usd_day:+rate.toFixed(4), hashrate:hr },
    eta_realized: {
      to_100:{ days:etaDays(100), years:yr(etaDays(100)) },
      to_1000:{ days:etaDays(1000), years:yr(etaDays(1000)) } },
    eta_projected: {
      to_1000: ms(1000), to_10000: ms(10000), to_100000: ms(100000) },
    gap:`$${realized.toFixed(2)} realized from mining. Other avenues need identity setup to start earning.`
  };
}

// AUTONOMOUS revenue — classify every stream by TRUE autonomy. The operator wants to WATCH, not approve.
// running = earning now, zero input · setup-once = one identity setup then forever autonomous · human-each =
// needs a person per instance (NOT autonomous — excluded from the watch model). Money must land in an
// account that is legally the operator's; that one-time setup is the only irreducible human step.
async function autonomousRevenue(){
  const [led, ov, free] = await Promise.all([ ledger().catch(()=>({})), overview().catch(()=>({})), freeStreams().catch(()=>({})) ]);
  const minedDay = +(ov?.totals?.fleet_usd_day ?? 0), grcDay = +(ov?.totals?.grc_usd_day || 0);
  const streams = [
    { name:'CPU mining → XMR', autonomy:'stopped', setup:'OFF by choice', usd_day:0 },
    { name:'Gridcoin/BOINC → GRC', autonomy:'running', setup:'done', usd_day:+grcDay.toFixed(4) },
    { name:'Bandwidth DePIN', autonomy:'setup-once', setup:'fill depin.local.env → bin/depin-deploy.sh up', usd_day:0 },
    { name:'Base Builder Rewards', autonomy:'setup-once', setup:'Basename + Builder Score ≥ 40', usd_day:0 },
    { name:'tea.xyz staking', autonomy:'setup-once', setup:'register packages once', usd_day:0 },
    { name:'Auto-compounding yield', autonomy:'setup-once', setup:'one vault deposit', usd_day:0 },
    { name:'Airdrop accrual', autonomy:'setup-once', setup:'onchain history on a held wallet', usd_day:0 },
    { name:'Grants / audits / content', autonomy:'human-each', setup:'submit or publish each one', usd_day:0 },
  ];
  const running = streams.filter(s=>s.autonomy==='running');
  const autoNow = running.reduce((a,s)=>a+s.usd_day,0);
  return {
    running_usd_day:+autoNow.toFixed(4),
    realized_total:+(led?.cumulative||0).toFixed(4),
    counts:{ running:running.length, setup_once:streams.filter(s=>s.autonomy==='setup-once').length, human_each:streams.filter(s=>s.autonomy==='human-each').length },
    streams,
    truth:`${running.length} stream${running.length===1?'':'s'} earning now. ${streams.filter(s=>s.autonomy==='setup-once').length} more need one-time setup.`
  };
}

// AGENT WALLET — the operator's self-custody EVM wallet (Thomas). READS only here (keyless: native +
// USDC balance per chain via public RPC). The receive hub for autonomous revenue. Signing/sending lives
// in a separate, policy-gated, opt-in module (never over HTTP) — receive-first by design so it survives.
const USDC_ADDR = { eth:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', base:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', arbitrum:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831', optimism:'0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', polygon:'0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' };
async function agentWallet(){
  let meta; try{ meta=JSON.parse(await readFile(path.join(LAB,'config','agent-wallet.json'),'utf8')); }catch{ return { exists:false, note:'run node dashboard/wallet-gen.mjs to create it' }; }
  const A = meta.addresses || { evm:{ address:meta.address } };
  // EVM — native + USDC per chain (one address, all EVM chains + all ERC-20s)
  const evmAddr=A.evm.address, pad=evmAddr.slice(2).toLowerCase().padStart(64,'0');
  const evmBal=await Promise.all(Object.keys(CHAIN_RPC).map(async ch=>{
    const rpc=CHAIN_RPC[ch];
    const [natHex,usdcHex]=await Promise.all([ evmRpc(rpc,'eth_getBalance',[evmAddr,'latest']),
      USDC_ADDR[ch]? evmRpc(rpc,'eth_call',[{to:USDC_ADDR[ch],data:'0x70a08231'+pad},'latest']):Promise.resolve(null) ]);
    return { chain:ch, native: natHex!=null?+(parseInt(natHex,16)/1e18).toFixed(6):null, usdc: usdcHex&&usdcHex!=='0x'?+(parseInt(usdcHex,16)/1e6).toFixed(2):0 };
  }));
  // Solana — SOL balance (keyless public RPC)
  let sol=null; if(A.solana){ try{ const r=await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:[A.solana.address]}),signal:AbortSignal.timeout(6000)}); const j=await r.json(); sol=j?.result?.value!=null?+(j.result.value/1e9).toFixed(6):null; }catch{} }
  // Bitcoin — balance via Blockstream (keyless)
  let btc=null; if(A.bitcoin){ try{ const j=await gjT(`https://blockstream.info/api/address/${A.bitcoin.address}`,6000); if(j?.chain_stats) btc=+(((j.chain_stats.funded_txo_sum||0)-(j.chain_stats.spent_txo_sum||0))/1e8).toFixed(8); }catch{} }
  // Cosmos — ATOM via public REST (keyless)
  let atom=null; if(A.cosmos){ try{ const j=await gjT(`https://rest.cosmos.directory/cosmoshub/cosmos/bank/v1beta1/balances/${A.cosmos.address}`,6000); const u=(j?.balances||[]).find(b=>b.denom==='uatom'); atom=u?+(+u.amount/1e6).toFixed(6):0; }catch{} }
  const totalUsdc=evmBal.reduce((a,b)=>a+(b.usdc||0),0);
  const funded = totalUsdc>0 || evmBal.some(b=>b.native>0) || sol>0 || btc>0 || atom>0;
  const ecosystems=[
    { id:'evm', address:evmAddr, covers:A.evm?.covers||'EVM chains + ERC-20', balances:evmBal, summary:`$${totalUsdc.toFixed(2)} USDC + native` },
    { id:'solana', address:A.solana?.address, covers:A.solana?.covers, sol, summary: sol!=null?`${sol} SOL`:'—' },
    { id:'bitcoin', address:A.bitcoin?.address, covers:A.bitcoin?.covers, btc, summary: btc!=null?`${btc} BTC`:'—' },
    { id:'cosmos', address:A.cosmos?.address, covers:A.cosmos?.covers, atom, summary: atom!=null?`${atom} ATOM`:'—' },
  ].filter(e=>e.address);
  // revenue routing — which stream lands which token on which ecosystem (the "hundreds of coins" made tractable)
  const routing=[
    { stream:'Base Builder Rewards · EVM airdrops · EVM yield · grants', token:'ETH/USDC/various', lands:'evm' },
    { stream:'Solana airdrops · many DePIN', token:'SOL/SPL', lands:'solana' },
    { stream:'Telegram tap-to-earn', token:'TON', lands:'TON (derivable — follow-up)' },
    { stream:'Cosmos airdrops', token:'ATOM/IBC', lands:'cosmos' },
    { stream:'BTC cashback (Lolli) · BTC holdings', token:'BTC', lands:'bitcoin' },
    { stream:'CPU mining', token:'XMR', lands:'separate Monero wallet (not EVM)' },
  ];
  return { exists:true, label:meta.label, primary:evmAddr, ecosystems, routing, funded, total_usdc:+totalUsdc.toFixed(2),
    architecture:'ONE seed → one address per ECOSYSTEM, each holding many tokens. EVM≠Solana≠BTC≠Cosmos (cannot receive each other). One mnemonic backs up all of them — recoverable in Phantom/Keplr/hardware.',
    note: funded?'Funded — watch balances climb across ecosystems.':'Empty + ready across 4 ecosystems. Each stream routes to its matching address (see routing). Keyless reads — no key touched.',
    security:'HOT wallet, key on your machine only (chmod 600, gitignored). Operating/earned funds only; hold real value on hardware. Back up the mnemonic offline.' };
}

// AGENT PLAN — the bounded autonomous decision (READ-ONLY here; moves nothing). Picks the best
// allowlisted organic-yield pool for idle USDC, within caps. The execution daemon (agent-trader.mjs)
// acts on this ONLY when policy.enabled && funded. Destinations come from the policy allowlist, never data.
async function agentPlan(){
  let pol; try{ pol=JSON.parse(await readFile(path.join(LAB,'config','agent-wallet-policy.json'),'utf8')); }catch{ return { error:'no policy' }; }
  const [w, y] = await Promise.all([ agentWallet().catch(()=>({})), yields().catch(()=>({})) ]);
  const evm = (w.ecosystems||[]).find(e=>e.id==='evm');
  const byChain = {}; (evm?.balances||[]).forEach(b=>{ byChain[b.chain]={ usdc:b.usdc||0, native:b.native||0 }; });
  // live organic APY per allowlisted pool (match the engine's base yields by project+chain+USDC)
  const baseY = (y.base||[]).concat(y.top||[]);
  const ranked = (pol.allowlist?.pools||[]).map(p=>{
    const hit = baseY.find(x=> /aave/i.test(x.project) && x.chain && x.chain.toLowerCase()===p.chain && /usdc/i.test(x.symbol));
    return { ...p, apy: hit? hit.apy : null, idle_usdc: (byChain[p.chain]?.usdc)||0, native:(byChain[p.chain]?.native)||0 };
  }).sort((a,b)=>(b.apy||0)-(a.apy||0));
  const funded = ranked.some(p=>p.idle_usdc>0) || (evm?.balances||[]).some(b=>b.native>0);
  const best = ranked.find(p=>p.idle_usdc>0 && p.apy!=null) || ranked[0];
  const cap = pol.caps||{};
  let action;
  if(!funded) action = { do:'hold', reason:'wallet empty — fund it with USDC (+ a little ETH for gas) on Base or Arbitrum to activate' };
  else if(!best || best.idle_usdc<=0) action = { do:'hold', reason:'no idle USDC on an allowlisted chain' };
  else { const amt = Math.min(best.idle_usdc, cap.max_per_action_usd||50, cap.max_total_deployed_usd||100);
    action = { do:'deposit', amount_usdc:+amt.toFixed(2), into:best.name, chain:best.chain, pool:best.pool, apy:best.apy,
      gas_ok: (best.native||0) >= (cap.min_native_reserve||0.0015) };
  }
  return { armed: !!pol.enabled, funded, dry_run: !pol.enabled || !funded,
    plan: action, ranked: ranked.map(r=>({ name:r.name, chain:r.chain, apy:r.apy, idle_usdc:r.idle_usdc })),
    caps: pol.caps, allowlist_pools: (pol.allowlist?.pools||[]).length, withdraw_to: pol.allowlist?.withdraw_to,
    status: pol.enabled ? (funded?'ARMED + funded — the daemon will execute this within bounds':'ARMED but empty — fund the wallet to activate') : 'DRY-RUN — deciding autonomously, moving nothing. Fund + arm to go live.',
    honest: pol.honest };
}
async function setArm(on){
  const fp=path.join(LAB,'config','agent-wallet-policy.json');
  let pol; try{ pol=JSON.parse(await readFile(fp,'utf8')); }catch{ return { ok:false }; }
  pol.enabled = !!on; await writeFile(fp, JSON.stringify(pol,null,2));
  return { ok:true, enabled: pol.enabled, note: pol.enabled?'ARMED. The agent will deploy idle USDC into allowlisted yield within caps once the wallet is funded.':'Disarmed — back to dry-run, moves nothing.' };
}

// AUTO AIRDROP COLLECTOR — the never-miss radar. Sorts by urgency, tracks claim deadlines, scans the
// operator's public addresses. Keyless. Claiming stays the operator's signed action (auto-claim = drain vector).
async function airdropRadar(){
  let reg; try{ reg=JSON.parse(await readFile(path.join(LAB,'config','airdrop-radar.json'),'utf8')); }catch{ return { count:0, airdrops:[] }; }
  const order={ claimable:0, 'snapshot-pending':1, farming:2, rumored:3, ended:4 };
  const now=Date.now();
  const drops=(reg.airdrops||[]).map(a=>{
    let days=null, urgent=false;
    if(a.claim_deadline){ const dl=Date.parse(a.claim_deadline); if(!isNaN(dl)){ days=Math.ceil((dl-now)/86400000); urgent=days>=0&&days<=14; } }
    return { ...a, days_to_deadline:days, urgent };
  }).sort((x,y)=> (order[x.status]??9)-(order[y.status]??9) || (x.days_to_deadline??99999)-(y.days_to_deadline??99999));
  const counts={}; for(const d of drops) counts[d.status]=(counts[d.status]||0)+1;
  // addresses we scan (the agent wallet's ecosystems + any public addresses in wallets-watch)
  const scanned=[];
  try{ const aw=JSON.parse(await readFile(path.join(LAB,'config','agent-wallet.json'),'utf8')); for(const [eco,v] of Object.entries(aw.addresses||{})) scanned.push({ eco, address:v.address }); }catch{}
  try{ const ww=JSON.parse(await readFile(path.join(LAB,'config','wallets-watch.json'),'utf8')); for(const w of (ww.wallets||[])) if(!scanned.some(s=>s.address===w.address)) scanned.push({ eco:w.chain||'evm', address:w.address }); }catch{}
  const free=drops.filter(d=>/free/.test(d.cost||''));
  const farmingNow=drops.filter(d=>d.status==='farming');
  // auto-discovered tokenless DeFi candidates (refreshed daily by airdrop-fetcher.mjs)
  let discovered={ count:0, new_today:0, candidates:[] };
  try{ discovered=JSON.parse(await readFile(path.join(LAB,'data','airdrop-discovered.json'),'utf8')); }catch{}
  return { count:drops.length, counts, airdrops:drops, checkers:reg.checkers||[], scanned_addresses:scanned,
    discovered:{ count:discovered.count||0, new_today:discovered.new_today||0, date:discovered.date,
      candidates:(discovered.candidates||[]).slice(0,40) },
    urgent:drops.filter(d=>d.urgent), free_to_qualify:free.map(d=>d.name), farming_now:farmingNow.length,
    note:'Radar of every tracked airdrop, sorted by urgency. Add your EXISTING public addresses to config/wallets-watch.json to scan them for unclaimed drops (keyless). The orchestrator re-checks on a cadence + alerts before any claim window closes. You sign the claim.',
    honest:reg.honest };
}

// SYSTEM PLAYS — 100 ways to monetize OUR system, ranked by buildable × low-capital × ai-leverage.
async function systemPlays(){
  let cfg; try{ cfg=JSON.parse(await readFile(path.join(LAB,'config','system-plays.json'),'utf8')); }catch{ return { count:0, plays:[] }; }
  const eW={low:1,med:0.72,high:0.5}, bW={yes:1,partial:0.62,no:0.25};
  const scored=(cfg.plays||[]).map(p=>{ const score=Math.round(100*(bW[p.buildable]??0.6)*(eW[p.effort]??0.72)*(p.capital?0.7:1)*(p.ai?1.1:1)); return { ...p, score }; }).sort((a,b)=>b.score-a.score);
  const byCat={}; for(const p of scored){ (byCat[p.cat]=byCat[p.cat]||[]).push(p); }
  const catLabel={ security:'Security / bug-bounty (skill+AI → big $)', data:'Data products (sell our scanners)', monitor:'Monitoring / alerts', tools:'Tools / micro-SaaS', edge:'Trading / edge feeds', infra:'Infrastructure (run for pay)', content:'Content / research / influence', fintech:'Fintech-adjacent', agent:'Automation / agents', niche:'Niche / services' };
  return { count:scored.length, byCat, catLabel, top:scored.slice(0,12), plays:scored,
    note:'100 ways to turn the system (dashboard · keyless scanners · multi-chain wallet · mesh · quant engines · AI) into money. Ranked by buildable × low-capital × ai-leverage. The bug-bounty + data-product + monitoring lanes are the highest-EV for our stack.' };
}

// MONITORS — live keyless data-product feed. Serves the cron-written feed if fresh (<10min),
// else runs the fleet live. Each monitor = a real signal you can sell or trade off.
async function monitors(){
  try{ const f=JSON.parse(await readFile(path.join(LAB,'data','monitor-feed.json'),'utf8'));
    if(Date.now()-(f.ts||0) < 600000) return { ...f, source:'cron-cache', age_s:Math.round((Date.now()-f.ts)/1000) }; }catch{}
  const live=await runMonitors(); return { ...live, source:'live' };
}
// BUILDER — the autonomous build loop's status: what it has knocked down, what's queued, last tick.
function _jsonl(rel){ try{ return readFileSync(path.join(LAB,rel),'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean); }catch{ return []; } }
async function builder(){
  const led=_jsonl('data/build-ledger.jsonl'), q=_jsonl('data/build-queue.jsonl');
  const built=led.filter(e=>e.action==='built'), ticks=led.filter(e=>e.action==='tick');
  const specs=q.filter(o=>o.kind==='spec');
  let active=0; try{ active=(await loadMonitorRegistry()).monitors.length; }catch{}
  return { autonomous:true, monitors_active:active, built_by_loop:built.length, ideas_generated:q.length,
    spec_ideas_pending:specs.length, ticks_run:ticks.length, last_tick:ticks.at(-1)||null,
    recent_built:built.slice(-8).reverse().map(b=>({label:b.label,monetize:b.monetize,signal:b.first_signal,ts:b.ts})),
    recent_specs:specs.slice(-8).reverse().map(s=>({idea:s.idea,from:s.from,score:s.score})),
    note:'The loop (tools/builder-tick.mjs, cron 5min) generates new ideas, knocks down the next buildable monitor (verified before commit), and refreshes the fleet. No human in the loop. Spec ideas wait for a build pass.' };
}

// LINKS REGISTRY — a definite clickable link for EVERY bi-product avenue (521), generated by
// tools/gen-links-registry.mjs. Optional filters: ?type=signup|platform|source|learn|airdrop,
// ?catalogue=system|edge|..., ?q=substring, ?src=native (exact links only). Honest: most links are
// canonical category pointers, not one-click forms — see `linkSource`.
async function links(u){
  let reg; try{ reg=JSON.parse(await readFile(path.join(LAB,'config','links-registry.json'),'utf8')); }
  catch{ return { error:'links-registry.json missing — run: node tools/gen-links-registry.mjs', total:0, avenues:[] }; }
  const p=u?.searchParams; let av=reg.avenues||[];
  if(p?.get('type'))      av=av.filter(a=>a.type===p.get('type'));
  if(p?.get('catalogue')) av=av.filter(a=>a.catalogue===p.get('catalogue'));
  if(p?.get('src'))       av=av.filter(a=>a.src===p.get('src'));
  if(p?.get('q')){ const q=p.get('q').toLowerCase(); av=av.filter(a=>(a.name+' '+a.category+' '+a.note).toLowerCase().includes(q)); }
  return { total:reg.total, exactNativeLinks:reg.exactNativeLinks, generated:reg.generated,
    byType:reg.byType, byLinkSource:reg.byLinkSource, byCatalogue:reg.byCatalogue,
    showing:av.length, avenues:av,
    note:'Every bi-product avenue → one definite link. 🪂 airdrop links are CHECK-eligibility only; the operator signs all claims. Full human doc: docs/AVENUE-LINKS.md · short foundations-first list: docs/SIGNUP-LINKS.md.' };
}

// REAL address checker — paste any public address, get REAL onchain reads (balances, tx activity,
// token holdings) across ecosystems + airdrop-eligibility signals. Keyless. This is a functional TOOL,
// not a display: input → real RPC calls → real result. (Also system-play sp31, the airdrop checker.)
async function checkAddress(addr){
  if(!addr || typeof addr!=='string') return { error:'paste a public wallet address' };
  addr=addr.trim();
  // EVM
  if(/^0x[0-9a-fA-F]{40}$/.test(addr)){
    const pad=addr.slice(2).toLowerCase().padStart(64,'0');
    const chains=await Promise.all(Object.entries(CHAIN_RPC).map(async([ch,rpc])=>{
      const [bal,nonce,usdc]=await Promise.all([
        evmRpc(rpc,'eth_getBalance',[addr,'latest']),
        evmRpc(rpc,'eth_getTransactionCount',[addr,'latest']),
        USDC_ADDR[ch]?evmRpc(rpc,'eth_call',[{to:USDC_ADDR[ch],data:'0x70a08231'+pad},'latest']):Promise.resolve(null) ]);
      return { chain:ch, native: bal!=null?+(parseInt(bal,16)/1e18).toFixed(5):null,
        tx: nonce!=null?parseInt(nonce,16):null, usdc: usdc&&usdc!=='0x'?+(parseInt(usdc,16)/1e6).toFixed(2):0 };
    }));
    const totalTx=chains.reduce((a,c)=>a+(c.tx||0),0);
    const active=chains.filter(c=>(c.tx||0)>0).map(c=>c.chain);
    const usdcTotal=chains.reduce((a,c)=>a+(c.usdc||0),0);
    const sig=[];
    if(active.includes('base')) sig.push('Active on Base → Base network-token airdrop candidate (check builderscore.xyz too)');
    if(active.includes('arbitrum')) sig.push('Active on Arbitrum → Arbitrum-ecosystem drops');
    if(active.includes('optimism')) sig.push('Active on Optimism → OP retro/airdrop seasons');
    if(active.includes('polygon')) sig.push('Active on Polygon → Polymarket / Polygon ecosystem');
    if(totalTx===0) sig.push('No activity yet — this address is eligible for nothing. Use protocols (needs gas) to build eligibility.');
    return { ok:true, type:'EVM', address:addr, chains, total_tx:totalTx, active_chains:active, usdc_total:+usdcTotal.toFixed(2),
      signals:sig, checker_links:[{name:'Drops.bot',url:'https://www.drops.bot/'},{name:'AirdropScan',url:'https://airdropscan.io/'}],
      note:'Real onchain reads across 5 EVM chains. tx_count = activity (airdrop-eligibility proxy). Keyless — no key touched.' };
  }
  // Solana
  if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)){
    try{ const r=await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:[addr]}),signal:AbortSignal.timeout(7000)}); const j=await r.json();
      const sol=j?.result?.value!=null?+(j.result.value/1e9).toFixed(6):null;
      return { ok:true, type:'Solana', address:addr, sol, signals: sol>0?['Has SOL — active on Solana → Jupiter/Solana ecosystem drops']:['No SOL — fund + use Solana DeFi to qualify'],
        checker_links:[{name:'Jupiter',url:'https://jup.ag/'},{name:'Drops.bot',url:'https://www.drops.bot/'}], note:'Real Solana balance read. Keyless.' };
    }catch{ return { error:'Solana RPC busy, try again' }; }
  }
  // Bitcoin
  if(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr)){
    try{ const j=await gjT(`https://blockstream.info/api/address/${addr}`,7000); if(j?.chain_stats){ const bal=((j.chain_stats.funded_txo_sum||0)-(j.chain_stats.spent_txo_sum||0))/1e8; const txs=(j.chain_stats.tx_count||0);
      return { ok:true, type:'Bitcoin', address:addr, btc:+bal.toFixed(8), tx:txs, signals:[txs>0?`${txs} txs — active BTC address`:'No activity'], note:'Real Bitcoin balance read (Blockstream). Keyless.' }; } }catch{}
    return { error:'BTC lookup failed' };
  }
  // Cosmos
  if(/^cosmos1[a-z0-9]{38}$/.test(addr)){
    try{ const j=await gjT(`https://rest.cosmos.directory/cosmoshub/cosmos/bank/v1beta1/balances/${addr}`,7000); const u=(j?.balances||[]).find(b=>b.denom==='uatom'); const atom=u?+(+u.amount/1e6).toFixed(6):0;
      return { ok:true, type:'Cosmos', address:addr, atom, signals:[atom>0?'Has ATOM — active on Cosmos':'No ATOM'], note:'Real Cosmos balance read. Keyless.' }; }catch{}
    return { error:'Cosmos lookup failed' };
  }
  return { error:'Unrecognized address format. Supports EVM (0x…), Solana, Bitcoin (bc1…/1…/3…), Cosmos (cosmos1…).' };
}

// ── COMMAND — the single overview. The one screen that answers: what have we BANKED, what WORK is the
// engine actually producing (staged → crunched → shipped), is every cron alive, and what's lying green?
// Reads real files only. No fabricated numbers. This is the operator's track-and-control surface.
function command(){
  const now = Date.now();
  const rd = (p)=>{ try { return readFileSync(path.join(LAB,p),'utf8'); } catch { return ''; } };
  const rdJson = (p,def)=>{ try { return JSON.parse(rd(p)); } catch { return def; } };
  const jl = (p)=> rd(p).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
  const dirCount = (p)=>{ try { return readdirSync(path.join(LAB,p)).filter(f=>!f.startsWith('.')).length; } catch { return 0; } };
  const ageMin = (p)=>{ try { return Math.round((now - statSync(path.join(LAB,p)).mtimeMs)/60000); } catch { return null; } };

  // ── BANKED — realized $ only. accrued = mined/credited; banked = actually paid out; held = pre-existing bag.
  const led = jl('data/ledger.jsonl');
  const last = led[led.length-1] || {};
  const accrued = +(((last.mining_earned_usd||0) + (last.grc_earned_usd||0)).toFixed(4));
  const banked = +(((last.xmr_paid||0) * (last.xmr_price||0)).toFixed(2)); // only XMR actually paid to wallet
  const money = {
    banked_usd: banked,                       // truly in a wallet
    accrued_usd: accrued,                      // mined/credited, not yet paid (below payout floors)
    held_usd: +(last.held_usd||0).toFixed(2),  // existing holdings — NOT earned by the engine
    day_rate_usd: +(last.rate_usd_day||0).toFixed(4),
    note: banked===0 ? `$${accrued.toFixed(4)} accrued (mining+GRC) but $0 banked — both below payout floors. Holdings $${(last.held_usd||0).toFixed(0)} are a pre-existing bag, not engine income.` : `$${banked} banked.`,
  };

  // ── WORK TRACKER — three layers: staged → crunched (output on disk) → shipped (income).
  const wp = (()=>{ try { return workPacketSummary(); } catch { return {specs_total:0,drafted:0,remaining:0,by_need:{},recent:[]}; } })();
  const leadsAll = jl('data/audit-leads.jsonl');
  const auditWatch = rdJson('data/audit-watch.json',{});
  const ticksToday = jl('data/build-ledger.jsonl').filter(e=>e.action==='tick' && (e.ts||'').slice(0,10)===new Date(now).toISOString().slice(0,10));
  const publishedToday = ticksToday.reduce((s,t)=>s+(t.published||0),0);
  const work = {
    // CRUNCHED — real deliverables produced (on disk)
    audit_reports: dirCount('data/audit-reports'),
    grant_drafts: dirCount('data/grant-applications'),
    daily_briefs: dirCount('data/daily-briefs'),
    // STAGED — packets waiting to be crunched, by where they route
    packets_staged: dirCount('data/work-packets'),
    packets_remaining: wp.remaining,
    packets_by_route: wp.by_need,
    packets_recent: wp.recent,
    // LIVE WORK — the always-on production
    monitors_live: rdJson('data/monitor-feed.json',{}).live ?? null,
    audit_leads: leadsAll.length,
    audit_leads_high: leadsAll.filter(l=>String(l.severity||l.impact||'').toLowerCase().startsWith('high')).length,
    alerts_published_today: publishedToday,
    // SHIPPED — income-producing submissions (operator-gated). 0 until a human submits/posts.
    shipped: 0,
    shipped_note: 'Audits/grants are CRUNCHED (drafted) but not yet SHIPPED — submission is your sign step. That is the gap between output and income.',
  };

  // ── CRON HEALTH — every scheduler, liveness via its OUTPUT file mtime (truer than logs). Flags stale.
  const crons = [
    { id:'builder (5m)',        out:'data/build-ledger.jsonl',     stale:15 },
    { id:'orchestrator (1m)',   out:'data/automation-status.json', stale:10 },
    { id:'scanner (3m)',        out:'data/opportunities.jsonl',    stale:15 },
    { id:'ledger (1h)',         out:'data/ledger.jsonl',           stale:150 },
    { id:'governor (20s)',      out:'logs/governor-state.json',    stale:10 },
    { id:'audit (1h)',          out:'data/audit-watch.json',       stale:150 },
    { id:'report (24h)',        out:'reports/latest.json',         stale:1500 },
  ].map(c=>{ const a=ageMin(c.out); return { id:c.id, last_min:a, alive: a!==null && a<=c.stale, out:c.out }; });

  // ── THE LIES — things showing green that aren't. Each is a real, file-verified flag.
  const flags = [];
  const gov = rdJson('logs/governor-state.json',{});
  const govRecent = gov.recent||[]; const govFail = govRecent.filter(r=>r.ok===false).length;
  if (govRecent.length && govFail/govRecent.length >= 0.8) flags.push({ level:'warn', what:`Governor shows ON but ${govFail}/${govRecent.length} recent actions FAILED — it's not actually protecting.` });
  const paperAge = ageMin('data/paper-book.json');
  if (paperAge!==null && paperAge>360) flags.push({ level:'warn', what:`Paper book frozen ${Math.round(paperAge/60)}h — runPaper() not firing; the equity shown is stale.` });
  if ((last.hashrate||0)===0) flags.push({ level:'info', what:`Miner stopped (0 H/s) — deprioritized by choice, but the keepalive watchdog is unloaded so nothing would restart it.` });
  if (wp.remaining>200) flags.push({ level:'info', what:`${wp.remaining} spec work-units still queued — draining ~3/tick.` });
  const deadCrons = crons.filter(c=>!c.alive);
  if (deadCrons.length) flags.push({ level:'alert', what:`Stale/dead crons: ${deadCrons.map(c=>c.id).join(', ')} — no fresh output.` });

  // ── PENDING — the real approve-queue count (operator clicks money/identity moves).
  let pending_count = 0; try { const m=new Map(); for (const e of jl('data/action-queue.jsonl')) if(e.sig) m.set(e.sig,{...(m.get(e.sig)||{}),...e}); pending_count=[...m.values()].filter(e=>e.status==='pending').length; } catch {}

  return {
    ts: now,
    money,
    work,
    pending_actions: pending_count,
    crons,
    crons_alive: crons.filter(c=>c.alive).length,
    crons_total: crons.length,
    flags,
    summary: `Banked $${money.banked_usd} · accrued $${money.accrued_usd} · ${work.audit_reports} audits + ${work.grant_drafts} grants + ${work.daily_briefs} briefs crunched · ${work.packets_staged} packets staged (${work.packets_remaining} to crunch) · ${pending_count} cards awaiting your click · ${crons.filter(c=>c.alive).length}/${crons.length} crons alive · ${flags.length} flags`,
    note: 'Real files only. STAGED=runbook written · CRUNCHED=deliverable on disk · SHIPPED=you submitted it (income). The honest gap to income is the SHIP step.',
  };
}

// MONEY & TASKS — the one view: every avenue/task across all catalogues, normalized to
// {what it is · $ now (realized) · $ projected (EV/mo) · profit path · next action}, ranked.
// Answers "how much are we making, projected, per task, and how does each become profit."
function taskMoney(){
  const rd = (p)=>{ try { return JSON.parse(readFileSync(path.join(LAB,p),'utf8')); } catch { return null; } };
  const arr = (d)=> Array.isArray(d) ? d : (d ? Object.values(d).find(Array.isArray) || [] : []);
  // pull a representative $ out of a free-text range ("$15–300", "0.005–0.1 ETH (~$15–300)", "single crit $10k–$1M")
  const dollars = (s)=>{
    const t = String(s||'').replace(/,/g,'');
    const nums = [...t.matchAll(/\$\s?([\d.]+)\s*([kKmM])?/g)].map(m=>{ let n=parseFloat(m[1])||0; const u=(m[2]||'').toLowerCase(); if(u==='k')n*=1e3; if(u==='m')n*=1e6; return n; });
    if(!nums.length) return 0;
    return nums.reduce((a,b)=>a+b,0)/nums.length;
  };
  const tasks = [];
  // 1. income-streams → monthly = daily×30 (the only ones with realized)
  for(const s of arr(rd('config/income-streams.json'))){ const mo=+((s.est_daily_usd||0)*30).toFixed(2);
    tasks.push({ name:s.label||s.id, cat:s.category||'stream', what:String(s.source||'').slice(0,60), status:s.status||'?', actual_mo: s.status==='live'?mo:0, projected_mo:mo, profit:'recurring passive', next:s.status==='configure'?'connect account':s.status==='live'?'running':'set up', source:'streams' }); }
  // 2. knowledge-capital (grants/builder rewards) → est_value × prob
  for(const k of arr(rd('config/knowledge-capital.json'))){ const ev=dollars(k.est_value); const p=Number(k.prob)||0.3;
    tasks.push({ name:k.name, cat:k.category||'grant', what:String(k.note||'').slice(0,60), status:k.fits_us?'fits-us':'review', actual_mo:0, projected_mo:+(ev*p).toFixed(0), upside:ev, profit:k.recurring||'one-off', next:k.requires?`needs: ${String(k.requires).slice(0,40)}`:'apply', url:k.url, source:'grants' }); }
  // 3. bounty-targets → prize × odds factor (EV)
  for(const b of arr(rd('config/bounty-targets.json'))){ const odds=b.odds==='high'?0.08:b.odds==='med'?0.03:0.01;
    tasks.push({ name:b.name, cat:'bounty', what:`${b.platform||''} ${b.type||''} · ${b.lang||''}`.trim(), status:b.status||'open', actual_mo:0, projected_mo:+(((b.prize_usd||0)*odds)).toFixed(0), upside:b.prize_usd||0, profit:'per valid finding', next:b.access&&/gated/i.test(b.access)?'needs your account':'audit + submit', url:b.url, ends:b.ends, source:'bounties' }); }
  // 4. system-plays → pays range (upside; mostly unbuilt)
  for(const sp of arr(rd('config/system-plays.json'))){ const ev=dollars(sp.pays);
    tasks.push({ name:sp.name, cat:sp.cat||'play', what:String(sp.system||'').slice(0,60), status:sp.buildable==='yes'?'buildable':'idea', actual_mo:0, projected_mo:0, upside:ev, profit:String(sp.pays||'').slice(0,40), next:'build the play', source:'plays' }); }
  // 5. fringe-100 → (lo..hi) × probability = EV/mo
  for(const fr of arr(rd('config/fringe-100.json'))){ const mid=((Number(fr.lo)||0)+(Number(fr.hi)||0))/2; const p=Number(fr.p)||0.15;
    tasks.push({ name:fr.name, cat:fr.cat||'fringe', what:String(fr.note||'').slice(0,60), status:'idea', actual_mo:0, projected_mo:+(mid*p).toFixed(1), upside:Number(fr.hi)||0, profit:'creator/crypto', next:'spin up + test', source:'fringe' }); }
  // realized (banked) from the ledger
  let realized_mo=0; try { const led=readFileSync(path.join(LAB,'data','ledger.jsonl'),'utf8').trim().split('\n'); const last=JSON.parse(led[led.length-1]); realized_mo=+(((last.mining_earned_usd||0)+(last.grc_earned_usd||0))*30/Math.max(1,led.length)).toFixed(2); } catch {}
  // rollups
  const by_cat={}; for(const t of tasks){ const c=by_cat[t.cat] ||= {count:0,projected_mo:0,top_upside:0}; c.count++; c.projected_mo+=t.projected_mo||0; c.top_upside=Math.max(c.top_upside,t.upside||0); }
  const projected_mo = tasks.reduce((a,t)=>a+(t.projected_mo||0),0);
  const actual_mo = tasks.reduce((a,t)=>a+(t.actual_mo||0),0);
  const ranked = tasks.slice().sort((a,b)=> (b.projected_mo||0)-(a.projected_mo||0) || (b.upside||0)-(a.upside||0));
  return {
    ts: Date.now(),
    realized_mo: actual_mo,              // what's actually earning now (~$0 — honest)
    projected_mo: +projected_mo.toFixed(0),   // EV/month if executed (speculative, probability-weighted)
    avenues: tasks.length,
    by_category: Object.fromEntries(Object.entries(by_cat).map(([k,v])=>[k,{count:v.count,projected_mo:+v.projected_mo.toFixed(0),top_upside:v.top_upside}]).sort((a,b)=>b[1].projected_mo-a[1].projected_mo)),
    top_tasks: ranked.slice(0,40),
    all_tasks: ranked,
    summary: `${tasks.length} avenues · $${actual_mo.toFixed(2)}/mo realized · $${Math.round(projected_mo).toLocaleString()}/mo projected (EV, if executed) · top category: ${Object.entries(by_cat).sort((a,b)=>b[1].projected_mo-a[1].projected_mo)[0]?.[0]||'—'}`,
    honest: 'realized ≈ $0 (only mining trickle). Projected = probability-weighted EV per avenue IF executed — opportunity, not income. The work is to turn projected → realized: build/ship the high-EV ones, you approve the outward steps.',
  };
}

async function readBody(req){ let b=''; for await (const c of req) b+=c; return b; }

http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://localhost');
  const J=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o));};
  try {
    if(u.pathname==='/api/local')  return J(200, await localSummary());
    if(u.pathname==='/api/fleet')  return J(200, await fleet());
    if(u.pathname==='/api/mesh')   return J(200, await mesh());
    if(u.pathname==='/api/overview') return J(200, await overview());
    if(u.pathname==='/api/command') return J(200, command());
    if(u.pathname==='/api/money') return J(200, taskMoney());
    if(u.pathname==='/api/machine') return J(200, await machineDetail(u.searchParams.get('name')));
    if(u.pathname==='/api/machine-control') return J(200, await machineControl(u.searchParams.get('name'), u.searchParams.get('action')));
    if(u.pathname==='/api/fleet-control') return J(200, await fleetControl(u.searchParams.get('action')));
    if(u.pathname==='/api/payments') return J(200, await payments());
    if(u.pathname==='/api/income') return J(200, await income());
    if(u.pathname==='/api/health') return J(200, await nodeHealth());
    if(u.pathname==='/api/node-tune') return J(200, await nodeTune(u.searchParams.get('name'), u.searchParams.get('preset')));
    if(u.pathname==='/api/governor') return J(200, await governorStatus());
    if(u.pathname==='/api/governor-toggle') return J(200, await governorToggle(u.searchParams.get('action')));
    if(u.pathname==='/api/farm') return J(200, await farm());
    if(u.pathname==='/api/farm-status') return J(200, await farmStatus(u.searchParams.get('id'), u.searchParams.get('status')));
    if(u.pathname==='/api/edges') return J(200, await edges());
    if(u.pathname==='/api/yields') return J(200, await yields());
    if(u.pathname==='/api/spreads') return J(200, await spreads());
    if(u.pathname==='/api/opportunities') return J(200, await opportunities());
    if(u.pathname==='/api/world-pulse') return J(200, await worldPulse());
    if(u.pathname==='/api/formulations-test') return J(200, await formulationTest());
    if(u.pathname==='/api/free-streams') return J(200, await freeStreams());
    if(u.pathname==='/api/knowledge-capital') return J(200, await knowledgeCapital());
    if(u.pathname==='/api/fringe') return J(200, await fringe());
    if(u.pathname==='/api/report') return J(200, await report());
    if(u.pathname==='/api/automation') return J(200, await (async()=>{ try{ return JSON.parse(await readFile(path.join(LAB,'data','automation-status.json'),'utf8')); }catch{ return {automated:0,healthy:0,tasks:[],daemons:[],note:'orchestrator warming up'}; } })());
    if(u.pathname==='/api/strategy') return J(200, await strategist());
    if(u.pathname==='/api/revenue') return J(200, await revenue());
    if(u.pathname==='/api/autonomous') return J(200, await autonomousRevenue());
    if(u.pathname==='/api/agent-wallet') return J(200, await agentWallet());
    if(u.pathname==='/api/agent-plan') return J(200, await agentPlan());
    if(u.pathname==='/api/audit') return J(200, await (async()=>{ try{ return JSON.parse(await readFile(path.join(LAB,'data','audit-watch.json'),'utf8')); }catch{ return {watched:0,audited:0,total_high:0,new_high_cards:0,targets:[],note:'audit-watch warming up'}; } })());
    if(u.pathname==='/api/audit/report'){ const t=u.searchParams.get('target'); if(!t) return J(400,{error:'?target= required'}); try{ return J(200, JSON.parse(await readFile(path.join(LAB,'data','audit-reports',t+'.json'),'utf8'))); }catch{ return J(404,{error:'no report for '+t}); } }
    if(u.pathname==='/api/audit/leads'){ const t=u.searchParams.get('target'); try{ const raw=await readFile(path.join(LAB,'data','audit-leads.jsonl'),'utf8'); const all=raw.split('\n').filter(Boolean).map(l=>{ try{return JSON.parse(l)}catch{return null} }).filter(Boolean); return J(200, t ? all.filter(x=>x.target===t) : all); }catch{ return J(200,[]); } }
    if(u.pathname==='/api/airdrops') return J(200, await airdropRadar());
    if(u.pathname==='/api/system-plays') return J(200, await systemPlays());
    if(u.pathname==='/api/links') return J(200, await links(u));
    if(u.pathname==='/api/monitors') return J(200, await monitors());
    if(u.pathname==='/api/builder') return J(200, await builder());
    if(u.pathname==='/api/execution') return J(200, await executionView());
    if(u.pathname==='/api/action' && req.method==='POST'){ const {sig,status}=JSON.parse((await readBody(req))||'{}'); return J(200, await resolveAction(sig,status)); }
    if(u.pathname==='/api/signal-tape') return J(200, await signalTapeView());
    if(u.pathname==='/api/regime') return J(200, await regimeView());
    if(u.pathname==='/api/grantfit') return J(200, await grantFitView());
    if(u.pathname==='/api/grantfit/run' && req.method==='POST'){ const b=JSON.parse((await readBody(req))||'{}'); return J(200, await runGrantFit({n:b.n||5})); }
    if(u.pathname==='/api/hackathonfit') return J(200, await hackathonFitView());
    if(u.pathname==='/api/hackathonfit/run' && req.method==='POST'){ const b=JSON.parse((await readBody(req))||'{}'); return J(200, await runHackathonFit({n:b.n||5})); }
    if(u.pathname==='/api/persistence'){ const pool=u.searchParams.get('pool'); return J(200, pool? await durabilityOf(pool) : await persistenceView()); }
    if(u.pathname==='/api/persistence/run' && req.method==='POST') return J(200, await runPersistence({}));
    if(u.pathname==='/api/carry') return J(200, await carryView());
    if(u.pathname==='/api/carry/run' && req.method==='POST') return J(200, await runCarry({}));
    if(u.pathname==='/api/sniper') return J(200, await contestSniperView());
    if(u.pathname==='/api/referral') return J(200, await referralStatus());
    if(u.pathname==='/api/digest'){ if(u.searchParams.get('format')==='md'){ const d=await digest(); res.writeHead(200,{'content-type':'text/markdown; charset=utf-8'}); res.end(d.markdown); return; } return J(200, await digest()); }
    if(u.pathname==='/api/pricing') return J(200, await pricing());
    if(u.pathname==='/api/paper') return J(200, await paperView());
    if(u.pathname==='/api/credentials') return J(200, credSummary());
    if(u.pathname==='/api/feed'){ if(u.searchParams.get('format')==='rss'){ const xml=await publicFeed('rss'); res.writeHead(200,{'content-type':'application/rss+xml; charset=utf-8'}); res.end(xml); return; } return J(200, await publicFeed('json')); }
    if(u.pathname==='/api/check') return J(200, await checkAddress(u.searchParams.get('address')));
    if(u.pathname==='/api/bounties') return J(200, await (async()=>{
      let t={targets:[]}, f={findings:[]};
      try{ t=JSON.parse(await readFile(path.join(LAB,'config','bounty-targets.json'),'utf8')); }catch{}
      try{ f=JSON.parse(await readFile(path.join(LAB,'config','bug-findings.json'),'utf8')); }catch{}
      const aW={ low:0.4, 'low-med':0.55, med:0.8, high:1 };
      const ranked=(t.targets||[]).map(x=>({ ...x, access_ok:/public|investigate/.test(x.access||x.status||''), score: Math.round((aW[(x.odds||'').split(' ')[0]]??0.5)*Math.log10(Math.max(100,x.prize_usd))*10) })).sort((a,b)=> (b.access_ok?1:0)-(a.access_ok?1:0) || b.score-a.score);
      // OPEN-CORE demo: the methodology + targets are FREE (open); the proprietary pro vuln-pattern
      // ruleset is GATED behind a license + lives in a private gitignored file (not in the public repo).
      const tier = await tierInfo('bug-hunt', 'Pro: our proprietary vuln-pattern ruleset (beyond the open checklist) + the AI-deep-audit pipeline that ranks exploit likelihood. Open methodology stays free; the finding-edge is licensed.');
      const proRules = await gate(null, async()=>{ const r=await proArtifact('audit'); return r?{ rules:r.rules?.length||0, families:r.families||[] }:{ rules:0 }; });
      return { count:ranked.length, targets:ranked, findings:f.findings||[], findings_count:(f.findings||[]).length,
        ...tier, pro_ruleset: proRules,
        note:'Bug-bounty operation. Open core = methodology + targets + basic Slither sweep (free). Pro = proprietary ruleset + AI-deep-audit (licensed). The agent audits; the operator holds the platform account + submits. F1 was in OUR OWN code — capability is real.', honest:t.honest };
    })());
    if(u.pathname==='/api/agent-arm') return J(200, await setArm(u.searchParams.get('on')==='1'));
    if(u.pathname==='/api/playbook') return J(200, await playbook());
    if(u.pathname==='/api/playbook-status'){
      const id=u.searchParams.get('id'), st=u.searchParams.get('status'); const fp=path.join(LAB,'config','playbook-state.json');
      let s={}; try{ s=JSON.parse(await readFile(fp,'utf8')); }catch{}
      if(id&&st){ s[id]=st; await writeFile(fp, JSON.stringify(s,null,2)); }
      return J(200, {ok:true, state:s});
    }
    if(u.pathname==='/api/knowledge-status'){
      const id=u.searchParams.get('id'), st=u.searchParams.get('status'); const fp=path.join(LAB,'config','knowledge-capital-state.json');
      let s={}; try{ s=JSON.parse(await readFile(fp,'utf8')); }catch{}
      if(id&&st){ s[id]=st; await writeFile(fp, JSON.stringify(s,null,2)); }
      return J(200, {ok:true, state:s});
    }
    if(u.pathname==='/api/eligibility') return J(200, await eligibility());
    if(u.pathname==='/api/ledger') return J(200, await ledger());
    if(u.pathname==='/api/compound') return J(200, await compound(u.searchParams));
    if(u.pathname==='/api/formulations') return J(200, await (async()=>{ try{ return JSON.parse(await readFile(path.join(LAB,'config','income-edge-formulations.json'),'utf8')); }catch{ return {formulations:[]}; } })());
    if(u.pathname==='/api/boinc')  return J(200, await boinc());
    if(u.pathname==='/api/wallet') return J(200, await wallet());
    if(u.pathname==='/api/state')  return J(200, {state: await gstate()});
    if(u.pathname==='/api/send' && req.method==='POST'){
      const {to,amount,confirm}=JSON.parse((await readBody(req))||'{}');
      if(!to||!amount) return J(400,{error:'need destination address + amount'});
      for(const [tok,p] of pendingSends) if(p.exp<Date.now()) pendingSends.delete(tok); // sweep expired
      if(!confirm){
        const token=`${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`;
        pendingSends.set(token,{to,amount:String(amount),exp:Date.now()+120000});
        return J(200,{ok:false,needs_confirm:true,confirm_token:token,to,amount,expires_in_sec:120});
      }
      const pending=pendingSends.get(confirm);
      pendingSends.delete(confirm);
      if(!pending||pending.to!==to||pending.amount!==String(amount)) return J(400,{error:'confirmation expired or details changed — click Send again'});
      const r=await rpc('transfer',{destinations:[{address:to,amount:Math.round(Number(amount)*1e12)}],priority:0,ring_size:16});
      return J(200, r.error?{error:r.error}:{ok:true,tx_hash:r.tx_hash,fee:(r.fee||0)/1e12});
    }
    if(u.pathname==='/api/control'){
      if(req.method!=='POST') return J(405,{error:'POST required'});
      const map={flatout:'mine-flatout.sh',idle:'start.sh',stop:'stop.sh'};
      const s=map[u.searchParams.get('action')];
      if(!s) return J(400,{error:'action must be flatout|idle|stop'});
      return exec(`"${LAB}/bin/${s}"`,(e,o)=>J(200,{ok:!e,out:(o||'').trim()}));
    }
    if(u.pathname==='/api/miner'){
      if(req.method!=='POST') return J(405,{error:'POST required'});
      const a=u.searchParams.get('action');
      if(a==='restart') return exec(`"${LAB}/bin/mine-flatout.sh"`,(e,o)=>J(200,{ok:!e,out:(o||'').trim()}));
      if(a==='pause'||a==='resume'){ const c=await cfg(); const t=c?.http?.['access-token']; const p=c?.http?.port||18000;
        try{ const r=await fetch(`http://127.0.0.1:${p}/json_rpc`,{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${t}`},body:JSON.stringify({method:a})}); return J(200,await r.json()); } catch(e){ return J(200,{error:String(e)}); } }
      return J(400,{error:'action must be pause|resume|restart'});
    }
    if(u.pathname==='/api/config' && req.method==='POST'){
      const {threads,mode}=JSON.parse((await readBody(req))||'{}'); const c=await cfg();
      if(threads) c.cpu['max-threads-hint']=Math.max(12,Math.min(100,Math.round(threads/8*100)));
      if(mode) c.randomx.mode=mode;
      await writeFile(path.join(LAB,'config','xmrig.json'),JSON.stringify(c,null,2));
      return exec(`"${LAB}/bin/mine-flatout.sh"`,(e,o)=>J(200,{ok:!e,threads,mode,out:(o||'').trim()}));
    }
    if(u.pathname==='/api/coins') return J(200, await coins());
    if(u.pathname==='/api/coin' && req.method==='POST'){
      const {id,address}=JSON.parse((await readBody(req))||'{}');
      const data=await coins(); const c=(data.coins||[]).find(x=>x.id===id);
      if(!c) return J(400,{error:'unknown coin'});
      if(address) c.address=String(address).trim();
      data.active=id; await writeFile(path.join(LAB,'config','coins.json'),JSON.stringify(data,null,2));
      if(c.engine==='cpuminer-opt'){
        if(!c.address) return J(400,{error:`${c.name} needs a payout address first`});
        const algo=c.cpuminerAlgo||c.algo;
        return exec(`"${LAB}/bin/mine-cpuminer.sh" "${algo}" "${c.pool}" "${c.address}"`,(e,o)=>{
          if(e && /not built/.test(o||'')) return J(200,{ok:false,note:`${c.name}: cpuminer engine still building — try again in a minute`});
          return J(200,{ok:!e,coin:c.name,out:(o||'').trim()});
        });
      }
      const XMRIG=new Set(['rx/0','rx/wow','rx/arq','rx/yada','rx/sfx','gr','cn/gpu','cn/r','cn/half']);
      if(!XMRIG.has(c.algo)) return J(200,{ok:true,note:`${c.name} · ${c.chain} needs ${c.note||'extra setup'} — saved, not mining yet`});
      if(!c.address) return J(400,{error:`${c.name} needs a payout address first`});
      const x=await cfg();
      x.pools[0]={algo:c.algo,url:c.pool,user:c.address,pass:'x',keepalive:true,tls:false,'rig-id':'m1-air',...(c.payout==='XMR'?{coin:'monero'}:{})};
      await writeFile(path.join(LAB,'config','xmrig.json'),JSON.stringify(x,null,2));
      return exec(`"${LAB}/bin/mine-flatout.sh"`,(e,o)=>J(200,{ok:!e,coin:c.name,out:(o||'').trim()}));
    }
    const f=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,'').replace(/\.\./g,'');
    const b=await readFile(path.join(__dirname,f));
    res.writeHead(200,{'content-type':f.endsWith('.html')?'text/html':'text/plain'});res.end(b);
  } catch { res.writeHead(404);res.end('not found'); }
}).listen(PORT,'127.0.0.1',()=>console.log(`dashboard → http://127.0.0.1:${PORT}`));
