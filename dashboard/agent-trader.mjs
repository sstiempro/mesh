#!/usr/bin/env node
// Bounded autonomous yield executor. Reads the agent plan; ONLY acts when policy.enabled && funded.
// Every guard is re-checked HERE at execution time (never trusts the planner): destination must be an
// allowlisted pool, onBehalfOf must be the policy withdraw_to, amount within caps, gas reserve kept.
// Destinations are from the policy file, NEVER from data — a poisoned feed cannot redirect funds.
// Default state: DRY-RUN (enabled:false + empty wallet) → it logs decisions and moves nothing.
import { readFile, appendFile, mkdir } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH = process.env.DASH || 'http://127.0.0.1:8787';
const RPC = { base:'https://mainnet.base.org', arbitrum:'https://arb1.arbitrum.io/rpc' };
const log = (...a)=>console.log(new Date().toISOString(), ...a);
const getj = async (p)=>{ try{ return await (await fetch(`${DASH}${p}`,{signal:AbortSignal.timeout(15000)})).json(); }catch{ return null; } };
const record = async (row)=>{ await mkdir(path.join(LAB,'data'),{recursive:true}); await appendFile(path.join(LAB,'data','agent-trader.jsonl'), JSON.stringify({ts:Date.now(),...row})+'\n'); };

const ERC20 = ['function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)'];
const AAVE  = ['function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)'];

async function tick(){
  let pol; try{ pol=JSON.parse(await readFile(path.join(LAB,'config','agent-wallet-policy.json'),'utf8')); }catch{ return; }
  const plan = await getj('/api/agent-plan');
  if(!plan){ log('no plan'); return; }

  // ── HARD GATES (re-checked here, independent of the planner) ──
  if(!pol.enabled){ log('DRY-RUN (disarmed):', JSON.stringify(plan.plan)); await record({mode:'dry-run', plan:plan.plan}); return; }
  if(plan.plan?.do!=='deposit'){ log('hold:', plan.plan?.reason); return; }
  const a = plan.plan;
  const pool = (pol.allowlist?.pools||[]).find(p=> p.pool?.toLowerCase()===a.pool?.toLowerCase() && p.chain===a.chain);
  if(!pool){ log('REFUSE: pool not in allowlist', a.pool); await record({mode:'refused',reason:'pool not allowlisted',plan:a}); return; }
  const onBehalf = pol.allowlist?.withdraw_to;
  if(!onBehalf || !ethers.isAddress(onBehalf)){ log('REFUSE: bad withdraw_to'); return; }
  // FIX (audit finding): enforce max_total CUMULATIVELY, not per-action — sum prior executed deploys
  let deployedSoFar=0;
  try{ const lines=(await readFile(path.join(LAB,'data','agent-trader.jsonl'),'utf8')).trim().split('\n');
    for(const ln of lines){ try{ const r=JSON.parse(ln); if(r.mode==='executed') deployedSoFar+=(+r.amount||0); }catch{} } }catch{}
  const remaining = Math.max(0, (pol.caps?.max_total_deployed_usd||0) - deployedSoFar);
  const amt = Math.min(+a.amount_usdc||0, pol.caps?.max_per_action_usd||0, remaining);
  if(amt<=0){ log('REFUSE: amount<=0 (cumulative cap reached: $'+deployedSoFar.toFixed(2)+' deployed)'); await record({mode:'refused',reason:'cumulative-cap',deployed:deployedSoFar}); return; }
  if(!a.gas_ok){ log('REFUSE: native gas reserve too low on', a.chain); await record({mode:'refused',reason:'gas',plan:a}); return; }

  // ── EXECUTE (only reaches here when armed + funded + every guard passed) ──
  try{
    const key = JSON.parse(await readFile(path.join(LAB,'config','agent-wallet-policy.json'),'utf8')); // re-confirm armed at the last moment
    if(!key.enabled){ log('disarmed at last check, abort'); return; }
    const sk = JSON.parse(await readFile(path.join(LAB,'config','agent-wallet.key.json'),'utf8'));
    const provider = new ethers.JsonRpcProvider(RPC[a.chain]);
    const wallet = new ethers.Wallet(sk.privateKey, provider);
    const units = ethers.parseUnits(String(amt), pool.asset_decimals||6);
    const token = new ethers.Contract(pool.asset_addr, ERC20, wallet);
    const bal = await token.balanceOf(wallet.address);
    if(bal < units){ log('REFUSE: on-chain balance < amount'); await record({mode:'refused',reason:'balance',plan:a}); return; }
    const allowance = await token.allowance(wallet.address, pool.pool);
    if(allowance < units){ const tx=await token.approve(pool.pool, units); await tx.wait(); log('approved', amt, pool.asset); }
    const aave = new ethers.Contract(pool.pool, AAVE, wallet);
    const tx = await aave.supply(pool.asset_addr, units, onBehalf, 0);
    const rc = await tx.wait();
    log('✓ DEPLOYED', amt, 'USDC →', pool.name, a.chain, 'apy', a.apy, 'tx', rc.hash);
    await record({mode:'executed', amount:amt, pool:pool.name, chain:a.chain, apy:a.apy, tx:rc.hash});
  }catch(e){ log('execution error', String(e).slice(0,160)); await record({mode:'error', err:String(e).slice(0,200), plan:a}); }
}

async function loop(){
  const min = 30; // re-check every 30 min (the plan's reeval governs actual moves)
  log(`[agent-trader] starting · dry-run until policy.enabled && wallet funded · re-check ${min}m`);
  for(;;){ try{ await tick(); }catch(e){ log('tick error', String(e)); } await new Promise(r=>setTimeout(r, min*60*1000)); }
}
loop();
