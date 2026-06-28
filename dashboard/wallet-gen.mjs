#!/usr/bin/env node
// Generate the operator's self-custody EVM wallet (Thomas — agent steward wallet). The public address
// goes in config/agent-wallet.json (committable, public-only). The PRIVATE key + mnemonic go in
// config/agent-wallet.key.json — gitignored, chmod 600, on THIS machine only, NEVER printed to chat/logs/git.
// IDEMPOTENT: refuses to overwrite an existing wallet (overwriting would lose funds). Run once.
import { ethers } from 'ethers';
import { writeFile, chmod, readFile } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pubFile = path.join(LAB,'config','agent-wallet.json');
const keyFile = path.join(LAB,'config','agent-wallet.key.json');
const NAME = process.env.WALLET_NAME || 'Thomas';

try { const existing = JSON.parse(await readFile(pubFile,'utf8'));
  console.log('✓ wallet already exists — NOT regenerating (that would lose funds):', existing.address);
  process.exit(0);
} catch {}

const w = ethers.Wallet.createRandom();
const pub = {
  label: `${NAME} — agent steward wallet`,
  owner: NAME,
  address: w.address,
  created: new Date().toISOString(),
  chains: ['ethereum','base','arbitrum','optimism','polygon'],
  type: 'hot-wallet',
  note: 'Receive hub for autonomous bi-product revenue. EVM (same address on all listed chains). HOT wallet — key lives on this machine; keep only operating/earned funds here, hold real value on hardware.'
};
const key = {
  owner: NAME, address: w.address,
  privateKey: w.privateKey, mnemonic: w.mnemonic.phrase,
  warning: 'PRIVATE. Never share, paste, or commit. This file = full control of the wallet. Back up the mnemonic OFFLINE (write it on paper / hardware wallet). Anyone with this drains the wallet.'
};
await writeFile(pubFile, JSON.stringify(pub,null,2));
await writeFile(keyFile, JSON.stringify(key,null,2));
await chmod(keyFile, 0o600);

console.log('✓ created your wallet:', w.address);
console.log('  public meta   →', path.relative(LAB,pubFile));
console.log('  PRIVATE keys  →', path.relative(LAB,keyFile), '(gitignored · chmod 600 · NOT printed here)');
console.log('  ↳ open that file ONCE, write the mnemonic on paper, then you fully own it. It is on your machine only.');
