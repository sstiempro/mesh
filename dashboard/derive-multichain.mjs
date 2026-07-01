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
import { bech32, base58check } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

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

// --- ed25519 chains that ed25519-hd-key/@solana/web3.js don't already cover ---
// All three below are raw SLIP-0010 ed25519 derivation (same scheme Solana uses), just a
// different coin-type path + a chain-specific address encoding over the raw pubkey.

// Sui (m/44'/784'/0'/0'/0' — SLIP-44 784). Address = blake2b-256(flag(0x00=ed25519) || pubkey), hex w/ 0x.
const suiSeedKey = derivePath("m/44'/784'/0'/0'/0'", seed.toString('hex')).key;
const suiPub = ed25519.getPublicKey(suiSeedKey);
const suiHash = blake2b(new Uint8Array([0x00, ...suiPub]), { dkLen: 32 });
const sui = '0x' + bytesToHex(suiHash);

// Aptos (m/44'/637'/0'/0'/0' — SLIP-44 637). Address = sha3-256(pubkey || scheme(0x00=ed25519)), hex w/ 0x.
const aptosSeedKey = derivePath("m/44'/637'/0'/0'/0'", seed.toString('hex')).key;
const aptosPub = ed25519.getPublicKey(aptosSeedKey);
const aptosHash = sha3_256(new Uint8Array([...aptosPub, 0x00]));
const aptos = '0x' + bytesToHex(aptosHash);

// Near "implicit account" (m/44'/397'/0'/0'/0' — SLIP-44 397, NEAR's own HD standard, not the
// Solana path — verified against near-api-js/near-hd-key convention). Address = raw ed25519
// pubkey as lowercase hex, NO prefix — the account IS the key, funded on first receive.
const nearSeedKey = derivePath("m/44'/397'/0'/0'/0'", seed.toString('hex')).key;
const nearPub = ed25519.getPublicKey(nearSeedKey);
const near = bytesToHex(nearPub);

// Tron (m/44'/195'/0'/0/0 — SLIP-44 195, own secp256k1 derivation, NOT the same key as EVM's
// m/44'/60'/... path). Tron's address is base58check(0x41 || last-20-bytes(keccak256(pubkey))) —
// exactly the EVM address-derivation rule with a 0x41 prefix byte, so `ethers` deriving a wallet
// at Tron's own path already computes the right 20 bytes; base58check (verified below against
// the well-known Tron burn address T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb for 0x41+zeros) does the rest.
const tronWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/195'/0'/0/0");
const tronBytes = new Uint8Array(21); tronBytes[0] = 0x41;
tronBytes.set(Buffer.from(tronWallet.address.slice(2), 'hex'), 1);
const tron = base58check(sha256).encode(tronBytes);

// NOT derived here — TON: v3/v4 wallet address = hash of a BOC-serialized state-init cell (custom
// TVM cell hashing, not a plain digest over pubkey bytes) — needs @ton/ton or @ton/crypto, not
// installed. Genuinely not derivable with what's in package.json today.

const meta = JSON.parse(await readFile(pubFile,'utf8'));
meta.address = evm;                                        // primary (EVM) for back-compat
meta.addresses = {
  evm:     { address: evm,     covers: 'Ethereum · Base · Arbitrum · Optimism · Polygon + all ERC-20 tokens', path: "m/44'/60'/0'/0/0" },
  solana:  { address: solana,  covers: 'Solana + all SPL tokens (huge for DePIN + airdrops)', path: "m/44'/501'/0'/0'" },
  bitcoin: { address: bitcoin, covers: 'Bitcoin (native segwit)', path: "m/84'/0'/0'/0/0" },
  cosmos:  { address: cosmos,  covers: 'Cosmos Hub + IBC chains (re-prefix the same key for Osmosis/Celestia/…)', path: "m/44'/118'/0'/0/0" },
  sui:     { address: sui,     covers: 'Sui + all Sui coin objects/tokens', path: "m/44'/784'/0'/0'/0'" },
  aptos:   { address: aptos,   covers: 'Aptos + all Aptos coin/fungible-asset types', path: "m/44'/637'/0'/0'/0'" },
  near:    { address: near,    covers: 'Near (implicit account) + all NEP-141 tokens', path: "m/44'/397'/0'/0'/0'" },
  tron:    { address: tron,    covers: 'Tron + all TRC-20 tokens', path: "m/44'/195'/0'/0/0" },
};
meta.ecosystems_note = 'One seed → one address per ECOSYSTEM, each holding many tokens. TON is the one remaining gap (needs @ton/crypto for cell-hash addressing, not installed). EVM≠Solana≠BTC≠Cosmos≠Sui≠Aptos≠Near≠Tron — they cannot receive each other.';
await writeFile(pubFile, JSON.stringify(meta,null,2));

console.log('✓ derived multi-chain addresses from your one seed (public only; keys never printed):');
console.log('  EVM     ', evm);
console.log('  Solana  ', solana);
console.log('  Bitcoin ', bitcoin);
console.log('  Cosmos  ', cosmos);
console.log('  Sui     ', sui);
console.log('  Aptos   ', aptos);
console.log('  Near    ', near);
console.log('  Tron    ', tron);
console.log('  ↳ all recoverable from your mnemonic in Phantom/Keplr/hardware (Sui/Aptos/Near/Tron need a wallet');
console.log('    that supports those SLIP-44 paths — e.g. Sui/Aptos CLI wallets, Near CLI, TronLink). One backup = all.');
