#!/usr/bin/env node
// Content engine — generates a PUBLISHABLE daily "Mesh Intelligence" brief from the live keyless
// engines (pulse · real yield · arbitrage · opportunities · fringe). This is the faceless-content /
// newsletter / InfoFi creation play ACTUALIZED + RUNNING: a real product artifact produced
// autonomously every day. Writes reports/YYYY-MM-DD.md + reports/latest.md + reports/latest.json.
// The only step the agent can't do is hit "publish" under the operator's identity.
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH = process.env.DASH || 'http://127.0.0.1:8787';
const getj = async (p) => { try { return await (await fetch(`${DASH}${p}`, { signal: AbortSignal.timeout(15000) })).json(); } catch { return null; } };
const log = (...a) => console.log(new Date().toISOString(), ...a);

function pick(arr){ return arr && arr.length ? arr[Math.floor(Date.now()/86400000) % arr.length] : null; } // rotates daily, deterministic

async function generate(){
  const [pulse, opp, yields, fringe, free, ledger] = await Promise.all([
    getj('/api/world-pulse'), getj('/api/opportunities'), getj('/api/yields'),
    getj('/api/fringe'), getj('/api/free-streams'), getj('/api/ledger') ]);
  const date = new Date().toISOString().slice(0,10);
  const by = yields?.base?.[0] || yields?.top?.[0];
  const arb = opp?.best_arb;
  const dom = fringe?.mc?.dominant || [];
  const fr = pick((fringe?.concepts||[]).filter(c=>c.cat!=='foundation'));
  const fg = pulse?.fng, reg = pulse?.regime;

  const md = `# Mesh Intelligence — ${date}

*A keyless, honest daily brief. Built from free public data by an autonomous mesh. No keys, no custody, no hype.*

---

## 🫀 The pulse
**Fear & Greed: ${fg ?? '—'}${pulse?.fng_label?` (${pulse.fng_label})`:''}** · market cap 24h ${pulse?.mcap_24h>=0?'+':''}${pulse?.mcap_24h ?? '—'}% · BTC dominance ${pulse?.btc_dom ?? '—'}%
${reg ? `\n> Regime read: **${reg}**` : ''}

${fg!=null ? (fg<=25 ? '_Extreme fear historically marks contrarian accumulation zones — the crowd is capitulating._' : fg>=75 ? '_Extreme greed historically marks froth — a time to de-risk, not chase._' : '_Mid-cycle: no strong sentiment edge; let mechanics lead._') : ''}

## 🌱 Real yield — the safe base layer
${by ? `Top organic, capital-appropriate yield right now: **${by.project} ${by.symbol}** on **${by.chain}** — **${by.apy}% APY** (${Math.round((by.organic||0)*100)}% from real fees, not emissions), $${((by.tvlUsd||0)/1e6).toFixed(0)}M TVL.

> Single-sided stablecoin lending on a cheap chain = no impermanent loss, withdraw anytime. The honest base for compounding small capital.` : '_Yield scanner warming up._'}

## ⚖️ Arbitrage check (honest)
${arb ? `Best cross-venue/triangular spread: **${arb.net_bps} bps net** of fees — ${arb.profitable ? '⚠️ clears on paper (verify live; almost always stale on a REST poll)' : '**negative after fees — the usual, honest result.** "Free" CEX arb is mostly a mirage; the fees eat it.'}` : '_Spread scanner warming up._'}

## 🎯 What dominates (from the stack test)
Across thousands of Monte-Carlo'd combinations, the zero-capital plays that win on effort-adjusted EV:
${dom.slice(0,6).map((d,i)=>`${i+1}. ${d.name}`).join('\n') || '_run the stack test_'}

> The lesson the test keeps teaching: it's **tail-driven** — most months are quiet; the value is the rare big hit, plus the foundations (build-in-public · onchain identity) that multiply everything.

## 🧪 Fringe spotlight
${fr ? `**${fr.name}** — ${fr.note}` : '_—_'}

## ⛏️ The mesh itself
${ledger && !ledger.empty ? `Cumulative mined: $${(ledger.cumulative||0).toFixed(4)} · the idle compute keeps a small fire lit while the edges compound.` : `Idle compute mining quietly; the real engine is the edges + compounding, not the pennies.`}

---

*Generated autonomously from free public data (DefiLlama · alternative.me · CoinGecko · exchange public APIs). Not financial advice. The honest thesis: most "free money" is small or a mirage — the edge is rigor, breadth, and compounding the few real ones.*
`;

  const dir = path.join(LAB,'reports'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,`${date}.md`), md);
  await writeFile(path.join(dir,'latest.md'), md);
  await writeFile(path.join(dir,'latest.json'), JSON.stringify({ date, pulse:fg, regime:reg, best_yield:by?`${by.project} ${by.symbol} ${by.apy}%`:null, dominant:dom.slice(0,6).map(d=>d.name), markdown_bytes:md.length, generated:Date.now() },null,1));
  log(`report written: reports/${date}.md (${md.length} bytes) · pulse ${fg} · yield ${by?by.apy+'%':'—'}`);
  return md;
}

const INTERVAL = +(process.env.REPORT_INTERVAL_SEC || 86400);
async function loop(){ for(;;){ try{ await generate(); }catch(e){ log('error', String(e)); } await new Promise(r=>setTimeout(r, INTERVAL*1000)); } }
if (process.argv.includes('--once')) { generate().then(()=>process.exit(0)); }
else { log(`[report-generator] starting · every ${INTERVAL}s → reports/`); loop(); }
