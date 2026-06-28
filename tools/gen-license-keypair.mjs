#!/usr/bin/env node
// gen-license-keypair.mjs — ONE-TIME setup for forge-proof open-core licensing. Creates an ed25519
// keypair: the PRIVATE key (config/license-private.local.json, gitignored — only the operator signs with
// it) and the PUBLIC key (config/license-public.json, committed — every install verifies with it).
// Run once:  node tools/gen-license-keypair.mjs
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIV = path.join(LAB, 'config', 'license-private.local.json');
const PUB = path.join(LAB, 'config', 'license-public.json');

if (existsSync(PRIV)) { console.error('✗ refusing to overwrite existing private key at config/license-private.local.json'); process.exit(1); }
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
await writeFile(PRIV, JSON.stringify({ _doc: 'PRIVATE license-signing key — NEVER commit/share. Sign with: node tools/issue-license.mjs', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, null, 2));
await writeFile(PUB, JSON.stringify({ _doc: 'PUBLIC license-verify key — committed. Installs verify pro licenses with this; it cannot mint keys.', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }, null, 2));
console.log('✓ keypair created.\n  private (gitignored): config/license-private.local.json\n  public  (commit it):  config/license-public.json\nNow issue licenses: node tools/issue-license.mjs <buyer-id> [days]');
