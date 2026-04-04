/**
 * On-chain Bitcoin wallet service for watch-only (xpub) wallets.
 *
 * Uses bitcoinjs-lib + bip32 + @bitcoinerlab/secp256k1 for local address
 * derivation (same stack as BlueWallet). Balance and transaction lookups
 * use an Electrum server via electrum-client (same as BlueWallet).
 *
 * Future: when mnemonic import is added, `buildTransaction` and
 * `broadcastTransaction` can be implemented here using the same libraries.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import { getXpub, getElectrumServer } from './walletStorageService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ElectrumClient = require('electrum-client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TcpSocket = require('react-native-tcp-socket');

const bip32 = BIP32Factory(ecc);

// Version byte hex strings for extended public key prefixes
const YPUB_HEX = '049d7cb2'; // ypub (BIP-49)
const ZPUB_HEX = '04b24746'; // zpub (BIP-84)

/** Convert a byte to 2-char hex */
function byteToHex(b: number): string {
  return b.toString(16).padStart(2, '0');
}

/**
 * Convert ypub/zpub to xpub format so bip32 can parse it.
 * All three contain the same HD key data, just different version bytes.
 */
function toXpub(extPubKey: string): string {
  const trimmed = extPubKey.trim();
  if (trimmed.startsWith('xpub')) return trimmed;

  const decoded = bs58check.decode(trimmed);
  const versionHex =
    byteToHex(decoded[0]) + byteToHex(decoded[1]) + byteToHex(decoded[2]) + byteToHex(decoded[3]);

  if (versionHex === YPUB_HEX || versionHex === ZPUB_HEX) {
    const data = new Uint8Array(decoded);
    data[0] = 0x04;
    data[1] = 0x88;
    data[2] = 0xb2;
    data[3] = 0x1e;
    return bs58check.encode(data);
  }

  return trimmed;
}

const ADDRESS_INDEX_PREFIX = 'onchain_addr_index_';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnchainTransaction {
  txid: string;
  type: 'incoming' | 'outgoing';
  amount: number; // sats (positive)
  confirmed: boolean;
  blockHeight: number | null;
  timestamp: number | null;
}

// ─── Internal state ───────────────────────────────────────────────────────────

/** Cache of derived HD nodes keyed by walletId */
const hdNodeCache = new Map<string, BIP32Interface>();

/** Shared Electrum client instance */
let electrumClient: any = null;
let electrumConnected = false;

// ─── Electrum helpers ─────────────────────────────────────────────────────────

/**
 * Parse Electrum server string (format: "host:port:protocol")
 * Protocol: 's' = SSL, 't' = TCP
 */
function parseElectrumServer(server: string): { host: string; port: number; protocol: string } {
  const parts = server.split(':');
  return {
    host: parts[0],
    port: parseInt(parts[1], 10) || 50002,
    protocol: parts[2] || 's',
  };
}

/** Get or create an Electrum client connection */
async function getElectrumClient(): Promise<any> {
  if (electrumClient && electrumConnected) {
    return electrumClient;
  }

  const serverStr = await getElectrumServer();
  const { host, port, protocol } = parseElectrumServer(serverStr);

  // Close any existing stale connection
  if (electrumClient) {
    try {
      electrumClient.close();
    } catch {}
  }

  electrumClient = new ElectrumClient(
    TcpSocket, // net module
    TcpSocket, // tls module (react-native-tcp-socket handles both)
    port,
    host,
    protocol === 's' ? 'tls' : 'tcp',
  );

  // Handle connection errors — mark as disconnected so next call reconnects
  electrumClient.onError = () => {
    electrumConnected = false;
  };

  await electrumClient.connect('lightning-piggy', '1.4');
  electrumConnected = true;

  return electrumClient;
}

/**
 * Convert a Bitcoin address to an Electrum scripthash.
 * Electrum uses reversed SHA-256 of the output script.
 */
function addressToScripthash(address: string): string {
  const script = bitcoin.address.toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  // Reverse the hash bytes
  const reversed = Buffer.from(hash).reverse();
  return reversed.toString('hex');
}

// ─── HD key helpers ───────────────────────────────────────────────────────────

function getHdNode(extPubKey: string): BIP32Interface {
  return bip32.fromBase58(toXpub(extPubKey));
}

async function getCachedNode(walletId: string): Promise<BIP32Interface> {
  const cached = hdNodeCache.get(walletId);
  if (cached) return cached;

  const xpub = await getXpub(walletId);
  if (!xpub) throw new Error(`No xpub found for wallet ${walletId}`);

  const node = getHdNode(xpub);
  hdNodeCache.set(walletId, node);
  return node;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Validate an xpub / ypub / zpub string. Returns an error message or null. */
export function validateXpub(extPubKey: string): string | null {
  try {
    bip32.fromBase58(toXpub(extPubKey));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid extended public key';
  }
}

/**
 * Derive a receive address at the given index.
 * Uses BIP-84 derivation path (m/0/index) relative to the xpub.
 */
export function deriveAddress(xpub: string, index: number): string {
  const node = getHdNode(xpub);
  const child = node.derive(0).derive(index);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey });
  if (!address) throw new Error('Failed to derive address');
  return address;
}

/** Get the next unused receive address for a wallet, incrementing the index. */
export async function getNextReceiveAddress(walletId: string): Promise<string> {
  const node = await getCachedNode(walletId);
  const key = `${ADDRESS_INDEX_PREFIX}${walletId}`;
  const stored = await AsyncStorage.getItem(key);
  const index = stored ? parseInt(stored, 10) : 0;

  const child = node.derive(0).derive(index);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey });
  if (!address) throw new Error('Failed to derive address');

  await AsyncStorage.setItem(key, String(index + 1));
  return address;
}

/** Peek at the current receive address without incrementing. */
export async function getCurrentReceiveAddress(walletId: string): Promise<string> {
  const node = await getCachedNode(walletId);
  const key = `${ADDRESS_INDEX_PREFIX}${walletId}`;
  const stored = await AsyncStorage.getItem(key);
  const index = stored ? parseInt(stored, 10) : 0;

  const child = node.derive(0).derive(index);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey });
  if (!address) throw new Error('Failed to derive address');
  return address;
}

/**
 * Fetch the aggregate balance for a wallet via Electrum.
 */
export async function getBalance(walletId: string): Promise<number | null> {
  try {
    const client = await getElectrumClient();
    const addresses = await getDerivedAddresses(walletId, 20);
    let total = 0;

    for (const addr of addresses) {
      const scripthash = addressToScripthash(addr);
      const result = await client.blockchainScripthash_getBalance(scripthash);
      total += (result.confirmed || 0) + (result.unconfirmed || 0);
    }

    return total;
  } catch (e) {
    console.warn('onchainService.getBalance failed:', e);
    electrumConnected = false; // Force reconnect on next call
    return null;
  }
}

/**
 * Fetch recent transactions for a wallet via Electrum.
 */
export async function getTransactions(walletId: string): Promise<OnchainTransaction[]> {
  try {
    const client = await getElectrumClient();
    const addresses = await getDerivedAddresses(walletId, 20);
    const txMap = new Map<string, OnchainTransaction>();

    const addressSet = new Set(addresses);

    for (const addr of addresses) {
      const scripthash = addressToScripthash(addr);
      const history = await client.blockchainScripthash_getHistory(scripthash);

      for (const item of history) {
        if (txMap.has(item.tx_hash)) continue;

        // Fetch raw tx hex and parse with bitcoinjs-lib to get amounts
        try {
          const rawHex = await client.blockchainTransaction_get(item.tx_hash, false);
          const tx = bitcoin.Transaction.fromHex(rawHex);

          // Sum outputs going to our addresses
          let outputSum = 0;
          for (const out of tx.outs) {
            try {
              const outAddr = bitcoin.address.fromOutputScript(out.script);
              if (addressSet.has(outAddr)) {
                outputSum += Number(out.value);
              }
            } catch {
              // Skip unrecognized output scripts
            }
          }

          // Sum inputs coming from our addresses (need to look up prev txs)
          let inputSum = 0;
          for (const inp of tx.ins) {
            try {
              const prevTxId = Buffer.from(inp.hash).reverse().toString('hex');
              const prevRaw = await client.blockchainTransaction_get(prevTxId, false);
              const prevTx = bitcoin.Transaction.fromHex(prevRaw);
              const prevOut = prevTx.outs[inp.index];
              if (prevOut) {
                const prevAddr = bitcoin.address.fromOutputScript(prevOut.script);
                if (addressSet.has(prevAddr)) {
                  inputSum += Number(prevOut.value);
                }
              }
            } catch {
              // Skip if we can't look up the input
            }
          }

          const net = outputSum - inputSum;
          txMap.set(item.tx_hash, {
            txid: item.tx_hash,
            type: net >= 0 ? 'incoming' : 'outgoing',
            amount: Math.abs(net),
            confirmed: item.height > 0,
            blockHeight: item.height > 0 ? item.height : null,
            timestamp: null,
          });
        } catch {
          // If raw tx fetch fails, still show the tx with unknown amount
          txMap.set(item.tx_hash, {
            txid: item.tx_hash,
            type: 'incoming',
            amount: 0,
            confirmed: item.height > 0,
            blockHeight: item.height > 0 ? item.height : null,
            timestamp: null,
          });
        }
      }
    }

    // Note: timestamps require fetching block headers per unique height,
    // which is too slow and causes connection drops. Deferred to #38
    // when transaction caching is implemented.

    return Array.from(txMap.values()).sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return 0;
      if (a.timestamp === null) return -1;
      if (b.timestamp === null) return 1;
      return b.timestamp - a.timestamp;
    });
  } catch (e) {
    console.warn('onchainService.getTransactions failed:', e);
    electrumConnected = false;
    return [];
  }
}

/** Returns true for xpub-imported wallets (all wallets currently). */
export function isWatchOnly(_walletId: string): boolean {
  return true;
}

/** Clean up cached state when a wallet is removed. */
export async function removeWallet(walletId: string): Promise<void> {
  hdNodeCache.delete(walletId);
  await AsyncStorage.removeItem(`${ADDRESS_INDEX_PREFIX}${walletId}`);
}

/** Disconnect the Electrum client */
export function disconnectElectrum(): void {
  if (electrumClient) {
    try {
      electrumClient.close();
    } catch {}
    electrumClient = null;
    electrumConnected = false;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getDerivedAddresses(walletId: string, count: number): Promise<string[]> {
  const node = await getCachedNode(walletId);
  const chain = node.derive(0);
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const child = chain.derive(i);
    const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey });
    if (address) addresses.push(address);
  }
  return addresses;
}

// ─── Future stubs ─────────────────────────────────────────────────────────────
// TODO(#39): Implement when mnemonic/generated wallet support is added
// export async function buildTransaction(...) { }
// export async function broadcastTransaction(...) { }
