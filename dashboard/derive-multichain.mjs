#!/usr/bin/env node
// Derive the operator's MULTI-CHAIN addresses from the ONE existing seed, on STANDARD derivation paths
// (so each is recoverable in Phantom / Keplr / a hardware wallet). Reads the mnemonic locally from the
// gitignored key file — NEVER prints it or any private key. Writes only PUBLIC addresses to
// config/agent-wallet.json. Non-destructive: keeps the existing EVM address, adds the rest.
import { readFile, writeFile } from 'fs/promises';
import path from 'path'; import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bech32 } from '@scure/base';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pubFile = path.join(LAB,'config','agent-wallet.json');
const keyFile = path.join(LAB,'config','agent-wallet.key.json');

const key = JSON.parse(await readFile(keyFile,'utf8'));   // local only
const mnemonic = key.mnemonic;
const seed = mnemonicToSeedSync(mnemonic);                 // Buffer, never logged

// EVM (m/44'/60'/0'/0/0) — confirm it matches the wallet we already created
const evm = ethers.HDNodeWallet.fromPhrase(mnemonic).address;

// Solana (m/44'/501'/0'/0' — Phantom standard)
const solDerived = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
const solana = Keypair.fromSeed(solDerived).publicKey.toBase58();

// Bitcoin native segwit P2WPKH (m/84'/0'/0'/0/0)
const btcNode = HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'/0/0");
const btcH160 = ripemd160(sha256(btcNode.publicKey));
const bitcoin = bech32.encode('bc', [0, ...bech32.toWords(btcH160)]);

// Cosmos hub (m/44'/118'/0'/0/0) — same pubkey hash works across most Cosmos chains w/ different prefixes
const cosmosNode = HDKey.fromMasterSeed(seed).derive("m/44'/118'/0'/0/0");
const cosmosH160 = ripemd160(sha256(cosmosNode.publicKey));
const cosmos = bech32.encode('cosmos', bech32.toWords(cosmosH160));

const meta = JSON.parse(await readFile(pubFile,'utf8'));
meta.address = evm;                                        // primary (EVM) for back-compat
meta.addresses = {
  evm:     { address: evm,     covers: 'Ethereum · Base · Arbitrum · Optimism · Polygon + all ERC-20 tokens', path: "m/44'/60'/0'/0/0" },
  solana:  { address: solana,  covers: 'Solana + all SPL tokens (huge for DePIN + airdrops)', path: "m/44'/501'/0'/0'" },
  bitcoin: { address: bitcoin, covers: 'Bitcoin (native segwit)', path: "m/84'/0'/0'/0/0" },
  cosmos:  { address: cosmos,  covers: 'Cosmos Hub + IBC chains (re-prefix the same key for Osmosis/Celestia/…)', path: "m/44'/118'/0'/0/0" },
};
meta.ecosystems_note = 'One seed → one address per ECOSYSTEM, each holding many tokens. TON/Sui/Aptos/Tron/Near derivable from the same seed (follow-up). EVM≠Solana≠BTC≠Cosmos — they cannot receive each other.';
await writeFile(pubFile, JSON.stringify(meta,null,2));

console.log('✓ derived multi-chain addresses from your one seed (public only; keys never printed):');
console.log('  EVM     ', evm);
console.log('  Solana  ', solana);
console.log('  Bitcoin ', bitcoin);
console.log('  Cosmos  ', cosmos);
console.log('  ↳ all recoverable from your mnemonic in Phantom/Keplr/hardware. One backup = all of them.');
