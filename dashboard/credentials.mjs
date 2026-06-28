// credentials.mjs — runtime READ-ONLY access to the operator's saved credential vault. The secrets live
// OUTSIDE this repo (the omnione master credentials file, or a path you set) and are NEVER copied in,
// committed, logged, or published. This just lets the lab USE the paid keys the operator already saved
// (Coinglass, WhaleAlert, CryptoPanic, CoinGecko Pro, Etherscan, Alchemy, RPCs…) instead of crude
// rate-limited / geo-blocked keyless endpoints.
//
// HARD LINE: PAPER-ONLY stands. Exchange TRADE keys are used for nothing here — read/data only, and the
// paper engine never places a real order. Values are returned only into runtime fetch calls; the only
// thing ever exposed (via /api) is credSummary() = boolean presence + counts, NEVER a value.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function vaultPath() {
  try { const p = JSON.parse(readFileSync(path.join(LAB, 'config', 'vault.local.json'), 'utf8')).path; if (p && existsSync(p)) return p; } catch {}
  if (process.env.VAULT_PATH && existsSync(process.env.VAULT_PATH)) return process.env.VAULT_PATH;
  const known = path.join(homedir(), 'Developer', 'omnione', 'env', '.env.credentials');
  return existsSync(known) ? known : null;
}
let _cache = null;
function load() {
  if (_cache) return _cache; _cache = {};
  const p = vaultPath(); if (!p) return _cache;
  try { for (const line of readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2] && !m[2].trim().startsWith('#')) _cache[m[1]] = m[2].trim(); } } catch {}
  return _cache;
}
export function cred(name) { const v = load()[name]; return v && v.length ? v : null; }
export function hasCred(name) { return !!cred(name); }

// dashboard-safe: NAMES + presence only, never values
export function credSummary() {
  const c = load(); const names = Object.keys(c);
  const probe = ['COINGLASS_API_KEY', 'WHALEALERT_API_KEY', 'CRYPTOPANIC_API_KEY', 'COINGECKO_API_KEY', 'ETHERSCAN_API_KEY', 'ALCHEMY_API_KEY', 'NANSEN_API_KEY', 'ARKHAM_API_KEY', 'SANTIMENT_API_KEY', 'DUNE_API_KEY', 'LUNARCRUSH_API_KEY', 'GLASSNODE_API_KEY'];
  const has = {}; for (const k of probe) has[k.replace('_API_KEY', '').toLowerCase()] = hasCred(k);
  return { loaded: names.length > 0, count: names.length, source: vaultPath() ? 'vault (external, never in this repo)' : 'none — set config/vault.local.json {path} or VAULT_PATH', has };
}
