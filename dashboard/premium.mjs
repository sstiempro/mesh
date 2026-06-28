// OPEN-CORE GATE — the "cool mechanism". The public repo ships these HOOKS + the free tier; the premium
// logic + the license stay PRIVATE (gitignored, scrubbed from the public push). This is how we open-source
// the shell (Builder Score / grants / sponsors) but keep the edge (alpha) proprietary + monetizable.
// See docs/OPEN-CORE-STRATEGY.md. License + pro rules are the operator's — never in the repo, never to the agent.
import { readFile } from 'node:fs/promises';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let _lic = null;
export async function license(){
  if(_lic) return _lic;
  try { _lic = JSON.parse(await readFile(path.join(LAB,'config','license.local.json'),'utf8')); }
  catch { _lic = process.env.PRO_LICENSE ? { tier:'pro', key:process.env.PRO_LICENSE } : { tier:'free' }; }
  return _lic;
}
export async function isPro(){ const l = await license(); return l.tier === 'pro' && !!l.key; }

// premium artifacts live in PRIVATE gitignored files (config/*-pro.local.json) — the IP, never public.
export async function proArtifact(name){
  try { return JSON.parse(await readFile(path.join(LAB,'config', name + '-pro.local.json'),'utf8')); }
  catch { return null; }
}

// gate(freeValue, proFn): returns the pro result only when licensed; otherwise the free tier. The call
// site (open) is identical; only the OUTPUT differs by license. This keeps the alpha out of the open repo.
export async function gate(freeValue, proFn){
  if (await isPro()) { try { return await proFn(); } catch { return freeValue; } }
  return freeValue;
}

// a standard "upgrade" descriptor for any feature's free response
export async function tierInfo(feature, proPitch){
  const pro = await isPro();
  return { tier: pro ? 'pro' : 'free', feature,
    upgrade: pro ? null : (proPitch || 'Pro tier unlocks the proprietary edge. The open core is free; the alpha is licensed.') };
}
