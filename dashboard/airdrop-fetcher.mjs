#!/usr/bin/env node
// Daily airdrop auto-discovery. Pulls DefiLlama's free open API (tokenless DeFi protocols = airdrop
// candidates farming users before a token launch), filters to categories that actually airdrop, and
// writes data/airdrop-discovered.json — tagging which are NEW since the last run. Keyless. The radar
// engine (/api/airdrops) merges these with the curated high-profile list, so airdrops are NEW EVERY DAY.
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(LAB,'data','airdrop-discovered.json');
const log = (...a)=>console.log(new Date().toISOString(), ...a);

// categories that realistically airdrop (DeFi protocols farming pre-token) — exclude CEX/bridge/chain/RWA
const AIRDROP_CATS = new Set(['Dexes','Dexs','Lending','Derivatives','Yield','CDP','Yield Aggregator',
  'Liquid Restaking','Liquid Staking','Options','Launchpad','Perps','Restaking','Farm','Leveraged Farming',
  'Options Vault','Synthetics','Algo-Stables','Liquidity manager','Basis Trading','RWA Lending','Prediction Market',
  'NFT Marketplace','NFT Lending','Bridge Aggregator','DEX Aggregator','Telegram Bot','Gaming','SoFi']);
const EXCLUDE = /CEX|Chain$|Bridge$|Wallet|Treasury Manager|Staking Pool/i;
const EXCLUDE_NAME = /Binance|Coinbase|Bybit|OKX|Kraken|Bitget|MEXC|Gemini|Robinhood|WBTC|USDD|Tether|Circle/i;

async function fetchCandidates(){
  const r = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(20000) });
  const all = await r.json();
  return all
    .filter(p => (!p.symbol || p.symbol === '-' || p.symbol === null))          // tokenless
    .filter(p => (p.tvl||0) >= 1e7)                                              // >$10M TVL = real adoption
    .filter(p => AIRDROP_CATS.has(p.category) && !EXCLUDE.test(p.category||'') && !EXCLUDE_NAME.test(p.name||''))
    .sort((a,b)=>(b.tvl||0)-(a.tvl||0))
    .slice(0, 60)
    .map(p => ({ id:'dl-'+(p.slug||p.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-'),
      name:p.name, chains:(p.chains||[]).slice(0,3), tvl:Math.round(p.tvl||0), category:p.category,
      url:p.url||('https://defillama.com/protocol/'+(p.slug||'')), source:'DefiLlama (tokenless DeFi)' }));
}

async function run(){
  let prev={}; try{ const o=JSON.parse(await readFile(OUT,'utf8')); for(const c of (o.candidates||[])) prev[c.id]=c.first_seen||o.date; }catch{}
  const today = new Date().toISOString().slice(0,10);
  const cands = (await fetchCandidates()).map(c => ({ ...c, first_seen: prev[c.id] || today, is_new: !prev[c.id] }));
  const newToday = cands.filter(c=>c.is_new).length;
  await mkdir(path.join(LAB,'data'),{recursive:true});
  await writeFile(OUT, JSON.stringify({ date:today, count:cands.length, new_today:newToday, candidates:cands }, null, 1));
  log(`discovered ${cands.length} tokenless DeFi airdrop candidates · ${newToday} NEW today · top: ${cands.slice(0,3).map(c=>c.name).join(', ')}`);
}

if (process.argv.includes('--once')) { run().then(()=>process.exit(0)); }
else { (async()=>{ for(;;){ try{ await run(); }catch(e){ log('error', String(e)); } await new Promise(r=>setTimeout(r, 86400*1000)); } })(); }
