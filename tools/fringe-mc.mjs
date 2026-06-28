#!/usr/bin/env node
// Monte-Carlo STACK harness for the 100 fringe concepts. Tests COMBINATIONS, not single ideas:
// under a weekly time budget, which portfolio of zero-capital plays maximizes income — and what
// dominates across many tests. Models fat tails (viral coin / big airdrop / crit bug) + FOUNDATION
// synergies (build-in-public, Basename, Farcaster-PoH multiply dependent plays). Deterministic
// (mulberry32) per the determinism contract. Honest: priors are rough; the MC shows DISTRIBUTIONS.
import { readFileSync, writeFileSync } from 'fs';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HORIZON = 12;                       // months — amortize one-time setup over this
const TRIALS = 5000;
const mulberry32 = (a)=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};

const data = JSON.parse(readFileSync(path.join(LAB,'config','fringe-100.json'),'utf8'));
const C = data.concepts;
const monthlyTime = (c)=> (c.ts||0)/HORIZON + (c.tw||0)*4.33;     // one-time amortized + ongoing
const payMult = (c)=> c.cat==='compute-mesh' ? (c.id||1) : 1;     // mesh stacks across devices; others conservative (no sybil stacking)
const ev = (c, syn=1)=> syn * payMult(c) * ((c.p||0)*((c.lo||0)+(c.hi||0))/2 + (c.tp||0)*(c.ta||0));

// foundation synergy: which foundations boost which categories (the combination multipliers)
function synergyFor(c, hasFound){
  let m=1;
  if(hasFound.has('Build-in-public (public GitHub)') && ['security-skill','data-product','knowledge-arb','creator-coins'].includes(c.cat)) m*=1.4;
  if(hasFound.has('Basename + onchain identity') && ['onchain-create','airdrop-points','market-liq'].includes(c.cat)) m*=1.25;
  if(hasFound.has('Hot farming wallet + Farcaster PoH') && ['airdrop-points','attention','creator-coins'].includes(c.cat)) m*=1.3;
  if(hasFound.has('Reusable build (one repo, many entries)') && ['onchain-create','security-skill'].includes(c.cat)) m*=1.15;
  return m;
}
const FOUND = C.filter(c=>c.cat==='foundation');
const PLAYS = C.filter(c=>c.cat!=='foundation');

// one month income draw for a concept (given synergy)
function draw(c, rng, syn){
  let v=0; if(rng()< (c.p||0)) v += (c.lo||0) + rng()*((c.hi||0)-(c.lo||0));
  if(rng()< (c.tp||0)) v += (c.ta||0);
  return v * payMult(c) * syn;
}
function mcPortfolio(concepts, seed){
  const hasFound=new Set(concepts.filter(c=>c.cat==='foundation').map(c=>c.name));
  const rng=mulberry32(seed); const monthly=[];
  for(let t=0;t<TRIALS;t++){ let m=0; for(const c of concepts){ if(c.cat==='foundation') continue; m+=draw(c,rng,synergyFor(c,hasFound)); } monthly.push(m); }
  monthly.sort((a,b)=>a-b);
  const q=(p)=>monthly[Math.floor(p*TRIALS)];
  const mean=monthly.reduce((a,b)=>a+b,0)/TRIALS;
  return { p10:Math.round(q(0.10)), p50:Math.round(q(0.50)), p90:Math.round(q(0.90)), p99:Math.round(q(0.99)), mean:Math.round(mean) };
}
// greedy stack by EV-per-hour under a weekly budget; foundations are ~free so always include
function buildStack(weeklyBudget, objectiveBias){
  const found=FOUND.slice();
  const hasFound=new Set(found.map(c=>c.name));
  const budget=weeklyBudget*4.33 - found.reduce((a,c)=>a+monthlyTime(c),0);
  // score each play by EV/hour, optionally bias toward tail (lottery) or floor (safe)
  const scored=PLAYS.map(c=>{ const syn=synergyFor(c,hasFound); const e=ev(c,syn); const tail=(c.tp||0)*(c.ta||0)*syn; const floor=(c.p||0)*(c.lo||0)*syn;
    const obj = objectiveBias==='lottery'? (e+2*tail) : objectiveBias==='safe'? (e+2*floor) : e;
    return { c, perHr: obj/Math.max(0.05,monthlyTime(c)), t:monthlyTime(c) }; }).sort((a,b)=>b.perHr-a.perHr);
  const pick=[...found]; let used=0;
  for(const s of scored){ if(used+s.t<=budget){ pick.push(s.c); used+=s.t; } }
  return pick;
}
function report(weekly){
  const stacks={
    'EV-max (balanced)': buildStack(weekly,'ev'),
    'Safe (max floor)':  buildStack(weekly,'safe'),
    'Lottery (max tail)':buildStack(weekly,'lottery'),
  };
  console.log(`\n========== TIME BUDGET: ${weekly} h/week ==========`);
  const coreCount={};
  for(const [name,stack] of Object.entries(stacks)){
    const d=mcPortfolio(stack, 12345);
    const plays=stack.filter(c=>c.cat!=='foundation');
    console.log(`\n  ${name} — ${plays.length} plays`);
    console.log(`    monthly $: p10 ${d.p10} · p50 ${d.p50} · p90 ${d.p90} · p99(tail) ${d.p99} · mean ${d.mean}`);
    console.log(`    top picks: ${plays.slice(0,8).map(c=>c.name).join(' · ')}`);
    for(const c of plays) coreCount[c.name]=(coreCount[c.name]||0)+1;
  }
  return coreCount;
}

console.log(`Fringe-stack Monte Carlo · ${C.length} concepts · ${TRIALS} trials/portfolio · ${HORIZON}-mo horizon`);
const core={};
for(const wk of [5,15,40]){ const cc=report(wk); for(const k in cc) core[k]=(core[k]||0)+cc[k]; }

// LEARN: which plays appear across the most winning stacks (the dominant core)
console.log('\n========== WHAT DOMINATES (appears across the most winning stacks) ==========');
Object.entries(core).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([n,k])=>console.log(`  ${k}×  ${n}`));

// FOUNDATION test: does build-in-public + identity actually move the needle? (with vs without)
console.log('\n========== FOUNDATION SYNERGY TEST (15h/wk, EV-max) ==========');
const base=buildStack(15,'ev');
const withF=mcPortfolio(base,777);
const noF=mcPortfolio(base.filter(c=>c.cat!=='foundation'),777);
console.log(`  WITH foundations: p50 $${withF.p50}/mo · p90 $${withF.p90}`);
console.log(`  WITHOUT:          p50 $${noF.p50}/mo · p90 $${noF.p90}`);
console.log(`  lift from foundations: p50 +${Math.round((withF.p50/Math.max(1,noF.p50)-1)*100)}% · p90 +${Math.round((withF.p90/Math.max(1,noF.p90)-1)*100)}%`);

// persist for the dashboard
const summary={ ts:Date.now(), trials:TRIALS, horizon:HORIZON,
  budgets:[5,15,40].map(wk=>{ const s=buildStack(wk,'ev'); return { weekly:wk, plays:s.filter(c=>c.cat!=='foundation').length, dist:mcPortfolio(s,12345), top:s.filter(c=>c.cat!=='foundation').slice(0,8).map(c=>c.name) }; }),
  dominant: Object.entries(core).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([name,k])=>({name,in_stacks:k})),
  foundation_lift:{ with:withF, without:noF } };
writeFileSync(path.join(LAB,'data','fringe-mc.json'), JSON.stringify(summary,null,1));
console.log('\nwrote data/fringe-mc.json');
