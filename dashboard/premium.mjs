// OPEN-CORE GATE — the "cool mechanism". The public repo ships these HOOKS + the free tier; the premium
// logic + the license stay PRIVATE (gitignored, scrubbed from the public push). This is how we open-source
// the shell (Builder Score / grants / sponsors) but keep the edge (alpha) proprietary + monetizable.
// See docs/OPEN-CORE-STRATEGY.md. License + pro rules are the operator's — never in the repo, never to the agent.
import { readFile } from 'node:fs/promises';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let _lic = null;
export async function license(){
  if(_lic) return _lic;
  try { _lic = JSON.parse(await readFile(path.join(LAB,'config','license.local.json'),'utf8')); }
  catch { _lic = process.env.PRO_LICENSE ? { tier:'pro', key:process.env.PRO_LICENSE } : { tier:'free' }; }
  return _lic;
}

// FORGE-PROOF licensing: the operator signs a license with a PRIVATE key (gitignored); every install
// verifies with the PUBLIC key (committed, config/license-public.json). Buyers self-host + verify but
// can't mint keys. Key format: <base64url(JSON{buyer,exp,tier})>.<base64url(ed25519-sig)>.
let _pub = null;
async function pubKey(){
  if(_pub !== null) return _pub;
  try { const { publicKey } = JSON.parse(await readFile(path.join(LAB,'config','license-public.json'),'utf8')); _pub = createPublicKey(publicKey); }
  catch { _pub = false; }
  return _pub;
}
export async function verifyLicense(key){
  const pub = await pubKey(); if(!pub || !key) return false;
  const [body, sig] = String(key).split('.'); if(!body || !sig) return false;
  let ok; try { ok = edVerify(null, Buffer.from(body), pub, Buffer.from(sig, 'base64url')); } catch { return false; }
  if(!ok) return false;
  try { const c = JSON.parse(Buffer.from(body, 'base64url').toString()); return c.tier === 'pro' && (!c.exp || Date.now() < c.exp); } catch { return false; }
}
export async function isPro(){
  const l = await license(); if(l.tier !== 'pro' || !l.key) return false;
  const pub = await pubKey();
  if(pub) return verifyLicense(l.key);        // public key present → cryptographically verify (real)
  return true;                                 // no public key yet (pre-setup) → trust a present key
}

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

// PRICING — the open-core upgrade surface. Pay-to = the operator's agent wallet (receive hub). After
// payment the operator runs tools/issue-license.mjs and hands the buyer a key.
export async function pricing(){
  let addr = null; try { addr = JSON.parse(await readFile(path.join(LAB,'config','agent-wallet.json'),'utf8')).address; } catch {}
  return {
    current: await isPro() ? 'pro' : 'free',
    tiers: [
      { name: 'Free', price: '$0', features: ['/api/feed (JSON + RSS)', 'daily auto-digest', 'all keyless monitors (delayed)', 'public action cards'] },
      { name: 'Pro', price: '$29/mo', crypto: true, features: ['realtime webhook push (no delay)', 'confluence high-conviction alerts', 'private vuln-pattern ruleset (bug-hunt)', 'priority + private signals'] },
    ],
    pay_to: addr,
    pay_note: addr ? `Pay USDC/ETH to ${addr} (any EVM chain) → operator issues your license key (verified, forge-proof).` : 'contact for payment rail',
    how: 'Open-core: the shell is free + public; Pro unlocks the proprietary edge via an ed25519-signed license.',
  };
}

// a standard "upgrade" descriptor for any feature's free response
export async function tierInfo(feature, proPitch){
  const pro = await isPro();
  return { tier: pro ? 'pro' : 'free', feature,
    upgrade: pro ? null : (proPitch || 'Pro tier unlocks the proprietary edge. The open core is free; the alpha is licensed.') };
}
