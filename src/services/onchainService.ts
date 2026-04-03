/**
 * On-chain Bitcoin wallet service for watch-only (xpub) wallets.
 *
 * Uses bitcoinjs-lib + bip32 + @bitcoinerlab/secp256k1 for local address
 * derivation (same stack as BlueWallet). Balance and transaction lookups
 * use the mempool.space REST API.
 *
 * Future: when mnemonic import is added, `buildTransaction` and
 * `broadcastTransaction` can be implemented here using the same libraries.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { getXpub, getElectrumServer } from './walletStorageService';

const bip32 = BIP32Factory(ecc);

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

interface MempoolUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

interface MempoolTx {
  txid: string;
  vin: { prevout: { scriptpubkey_address?: string; value: number } }[];
  vout: { scriptpubkey_address?: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

// ─── Internal state ───────────────────────────────────────────────────────────

/** Cache of derived HD nodes keyed by walletId */
const hdNodeCache = new Map<string, BIP32Interface>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHdNode(xpub: string): BIP32Interface {
  return bip32.fromBase58(xpub);
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

async function apiBase(_walletId?: string): Promise<string> {
  // Per-wallet override could be added via WalletMetadata.electrumServer
  return getElectrumServer();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Validate an xpub / ypub / zpub string. Returns an error message or null. */
export function validateXpub(xpub: string): string | null {
  try {
    bip32.fromBase58(xpub.trim());
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

  // Increment for next call
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
 * Fetch the aggregate balance (confirmed + unconfirmed) for a wallet by
 * scanning the first N derived addresses.
 */
export async function getBalance(walletId: string): Promise<number | null> {
  try {
    const addresses = await getDerivedAddresses(walletId, 20);
    const base = await apiBase(walletId);
    let total = 0;

    for (const addr of addresses) {
      const res = await fetch(`${base}/address/${addr}/utxo`);
      if (!res.ok) continue;
      const utxos: MempoolUtxo[] = await res.json();
      for (const utxo of utxos) {
        total += utxo.value;
      }
    }
    return total;
  } catch (e) {
    console.warn('onchainService.getBalance failed:', e);
    return null;
  }
}

/**
 * Fetch recent transactions for a wallet by scanning derived addresses.
 */
export async function getTransactions(walletId: string): Promise<OnchainTransaction[]> {
  try {
    const addresses = await getDerivedAddresses(walletId, 20);
    const addressSet = new Set(addresses);
    const base = await apiBase(walletId);
    const txMap = new Map<string, OnchainTransaction>();

    for (const addr of addresses) {
      const res = await fetch(`${base}/address/${addr}/txs`);
      if (!res.ok) continue;
      const txs: MempoolTx[] = await res.json();

      for (const tx of txs) {
        if (txMap.has(tx.txid)) continue;

        let inputSum = 0;
        let outputSum = 0;

        for (const vin of tx.vin) {
          if (
            vin.prevout?.scriptpubkey_address &&
            addressSet.has(vin.prevout.scriptpubkey_address)
          ) {
            inputSum += vin.prevout.value;
          }
        }
        for (const vout of tx.vout) {
          if (vout.scriptpubkey_address && addressSet.has(vout.scriptpubkey_address)) {
            outputSum += vout.value;
          }
        }

        const net = outputSum - inputSum;
        txMap.set(tx.txid, {
          txid: tx.txid,
          type: net >= 0 ? 'incoming' : 'outgoing',
          amount: Math.abs(net),
          confirmed: tx.status.confirmed,
          blockHeight: tx.status.block_height ?? null,
          timestamp: tx.status.block_time ?? null,
        });
      }
    }

    return Array.from(txMap.values()).sort(
      (a, b) => (b.timestamp ?? Infinity) - (a.timestamp ?? Infinity),
    );
  } catch (e) {
    console.warn('onchainService.getTransactions failed:', e);
    return [];
  }
}

/** Returns true for xpub-imported wallets (all wallets currently). */
export function isWatchOnly(_walletId: string): boolean {
  // Future: check import method — mnemonic wallets will return false
  return true;
}

/** Clean up cached state when a wallet is removed. */
export async function removeWallet(walletId: string): Promise<void> {
  hdNodeCache.delete(walletId);
  await AsyncStorage.removeItem(`${ADDRESS_INDEX_PREFIX}${walletId}`);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getDerivedAddresses(walletId: string, count: number): Promise<string[]> {
  const node = await getCachedNode(walletId);
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const child = node.derive(0).derive(i);
    const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey });
    if (address) addresses.push(address);
  }
  return addresses;
}

// ─── Future stubs ─────────────────────────────────────────────────────────────
// TODO: Implement when mnemonic/generated wallet support is added
// export async function buildTransaction(...) { }
// export async function broadcastTransaction(...) { }
