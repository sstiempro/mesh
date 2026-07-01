// referral.mjs — creative-sweep #9: monetize the traffic we already send. Every outbound avenue we recommend
// (exchanges, bridges, audit/quest platforms) can route through the operator's referral code — with full
// disclosure. The operator signs up ONCE per program (identity); the machine rewrites the links. Codes live
// in config/referral-codes.local.json (gitignored — never committed). Honest curation converts far better
// than link farms because we ARE the trusted, durability-scored curator.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODES = path.join(LAB, 'config', 'referral-codes.local.json');
let _codes = null;
async function codes() { if (_codes) return _codes; try { _codes = JSON.parse(await readFile(CODES, 'utf8')); } catch { _codes = {}; } return _codes; }

// rewrite an outbound URL through the operator's ref code if one is configured for that domain (with disclosure)
export async function applyReferral(url) {
  const c = await codes(); if (!url) return { url, ref: false };
  for (const [domain, cfg] of Object.entries(c)) {
    if (url.includes(domain) && cfg?.param && cfg?.code) {
      const sep = url.includes('?') ? '&' : '?';
      return { url: `${url}${sep}${encodeURIComponent(cfg.param)}=${encodeURIComponent(cfg.code)}`, ref: true, disclosed: true };
    }
  }
  return { url, ref: false };
}
export async function referralStatus() {
  const c = await codes();
  const wireable = ['binance.com', 'bybit.com', 'okx.com', 'hyperliquid (points)', 'layer3.xyz', 'galxe.com', 'jumper.exchange', 'debridge.finance', 'immunefi.com', 'gitcoin.co'];
  return {
    configured: Object.keys(c).length, domains: Object.keys(c), programs_wireable: wireable,
    template: { 'binance.com': { param: 'ref', code: 'YOURCODE' } },
    note: 'Sign up to each program (identity = yours), then add {domain:{param,code}} to config/referral-codes.local.json (gitignored). The machine rewrites recommended links through your code, with a transparent ref disclosure. You sign up; the machine monetizes the traffic it already sends.',
  };
}
