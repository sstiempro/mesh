#!/usr/bin/env node
// issue-license.mjs — the operator runs this AFTER confirming a pro payment (to the agent wallet or any
// rail). Signs a forge-proof pro license for the buyer. Hand them the printed key; they drop it into
// config/license.local.json on their install and the pro tier unlocks (verified against the public key).
// Usage:  node tools/issue-license.mjs <buyer-id> [days=365]
import { createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buyer = process.argv[2];
const days = +(process.argv[3] || 365);
if (!buyer) { console.error('usage: node tools/issue-license.mjs <buyer-id> [days=365]'); process.exit(1); }

let priv;
try { priv = createPrivateKey(JSON.parse(await readFile(path.join(LAB, 'config', 'license-private.local.json'), 'utf8')).privateKey); }
catch { console.error('✗ no signing key — run: node tools/gen-license-keypair.mjs'); process.exit(1); }

const claims = { buyer, tier: 'pro', exp: Date.now() + days * 864e5, iat: Date.now() };
const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
const sig = sign(null, Buffer.from(body), priv).toString('base64url');
const key = `${body}.${sig}`;

console.log(`✓ pro license for "${buyer}" (${days}d, expires ${new Date(claims.exp).toISOString().slice(0, 10)}):\n`);
console.log(key);
console.log(`\nBuyer drops this into config/license.local.json:\n${JSON.stringify({ tier: 'pro', key }, null, 2)}`);
