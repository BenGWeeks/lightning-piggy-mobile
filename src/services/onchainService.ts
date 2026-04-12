/**
 * On-chain Bitcoin wallet service using BDK (Bitcoin Development Kit).
 *
 * BDK handles: xpub derivation, Electrum sync, balance, transaction
 * history with amounts/directions/timestamps, UTXO management.
 *
 * Forked from Peach2Peach/bdk-rn with RN 0.83 fix.
 */

import {
  Wallet,
  Blockchain,
  Descriptor,
  DatabaseConfig,
  DescriptorSecretKey,
  Mnemonic,
} from 'bdk-rn';
import { Network, AddressIndex, KeychainKind } from 'bdk-rn/lib/lib/enums';
import AsyncStorage from '@react-native-async-storage/async-storage';
import bs58check from 'bs58check';
import { getXpub, getMnemonic, getElectrumServer } from './walletStorageService';

const ADDRESS_INDEX_PREFIX = 'onchain_addr_index_';

// ─── xpub conversion ─────────────────────────────────────────────────────────

const YPUB_HEX = '049d7cb2';
const ZPUB_HEX = '04b24746';

function byteToHex(b: number): string {
  return b.toString(16).padStart(2, '0');
}

function toXpub(extPubKey: string): string {
  const trimmed = extPubKey.trim();
  // Case-insensitive check so pasted/scanned XPUB… variants don't fall
  // through to bs58check.decode and throw on the first uppercase char.
  if (trimmed.slice(0, 4).toLowerCase() === 'xpub') return trimmed;

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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnchainTransaction {
  txid: string;
  type: 'incoming' | 'outgoing';
  amount: number;
  confirmed: boolean;
  blockHeight: number | null;
  timestamp: number | null;
}

/** Map a BDK transaction to our OnchainTransaction type and sort by timestamp (newest first). */
function mapAndSortTransactions(txList: any[]): OnchainTransaction[] {
  return txList
    .map((tx) => {
      const net = tx.received - tx.sent;
      return {
        txid: tx.txid,
        type: net >= 0 ? ('incoming' as const) : ('outgoing' as const),
        amount: Math.abs(net),
        confirmed: tx.confirmationTime != null,
        blockHeight: tx.confirmationTime?.height ?? null,
        timestamp: tx.confirmationTime?.timestamp ?? null,
      };
    })
    .sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return 0;
      if (a.timestamp === null) return -1;
      if (b.timestamp === null) return 1;
      return b.timestamp - a.timestamp;
    });
}

// ─── Internal state ───────────────────────────────────────────────────────────

const bdkWallets = new Map<string, Wallet>();
let blockchain: Blockchain | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseElectrumUrl(server: string): string {
  const parts = server.split(':');
  const host = parts[0];
  const port = parseInt(parts[1], 10) || 50002;
  const protocol = parts[2] || 's';
  return `${protocol === 's' ? 'ssl' : 'tcp'}://${host}:${port}`;
}

async function getBlockchain(): Promise<Blockchain> {
  if (blockchain) return blockchain;

  const serverStr = await getElectrumServer();
  const url = parseElectrumUrl(serverStr);

  blockchain = await new Blockchain().create({
    url,
    sock5: null,
    retry: 3,
    timeout: 10,
    stopGap: 20,
    // Verify the TLS certificate hostname matches the server. The BDK
    // default is false — leaving it off allows a network attacker to MITM
    // balance reads and silently drop/alter broadcast calls. We require
    // hostname verification on all Electrum SSL connections.
    validateDomain: true,
  });
  return blockchain;
}

async function getBdkWallet(walletId: string): Promise<Wallet> {
  const cached = bdkWallets.get(walletId);
  if (cached) return cached;

  let descriptor: Descriptor;
  let changeDescriptor: Descriptor;

  // Try mnemonic first (hot wallet), then xpub (watch-only)
  const mnemonic = await getMnemonic(walletId);
  if (mnemonic) {
    if (__DEV__) console.log('[BDK] Creating hot wallet from mnemonic');
    const bdkMnemonic = await new Mnemonic().fromString(mnemonic);
    const secretKey = await new DescriptorSecretKey().create(Network.Bitcoin, bdkMnemonic);
    descriptor = await new Descriptor().newBip84(secretKey, KeychainKind.External, Network.Bitcoin);
    changeDescriptor = await new Descriptor().newBip84(
      secretKey,
      KeychainKind.Internal,
      Network.Bitcoin,
    );
  } else {
    const rawXpub = await getXpub(walletId);
    if (!rawXpub) throw new Error(`No xpub or mnemonic found for wallet ${walletId}`);
    const xpub = toXpub(rawXpub);
    if (__DEV__) console.log('[BDK] Creating watch-only wallet from xpub');
    descriptor = await new Descriptor().create(`wpkh(${xpub}/0/*)`, Network.Bitcoin);
    changeDescriptor = await new Descriptor().create(`wpkh(${xpub}/1/*)`, Network.Bitcoin);
  }

  const dbConfig = await new DatabaseConfig().memory();
  const wallet = await new Wallet().create(descriptor, changeDescriptor, Network.Bitcoin, dbConfig);

  if (__DEV__) console.log('[BDK] Wallet created:', wallet.id);
  bdkWallets.set(walletId, wallet);
  return wallet;
}

// ─── Fee estimation ──────────────────────────────────────────────────────────

const MEMPOOL_API = 'https://mempool.space/api/v1/fees/recommended';
const TYPICAL_VBYTES = 140; // 1-in-1-out native SegWit

let cachedFees: { fast: number; medium: number; slow: number; timestamp: number } | null = null;
const FEE_CACHE_MS = 60_000; // 1 minute

/**
 * Fetch recommended fee rates from mempool.space.
 * Returns estimated transaction fees in sats for a typical 1-in-1-out tx.
 */
export async function estimateOnchainFee(): Promise<{
  fast: number;
  medium: number;
  slow: number;
}> {
  if (cachedFees && Date.now() - cachedFees.timestamp < FEE_CACHE_MS) {
    return cachedFees;
  }

  try {
    const res = await fetch(MEMPOOL_API);
    if (!res.ok) throw new Error(`mempool.space API error: ${res.status}`);
    const data = await res.json();

    const fees = {
      fast: Math.ceil((data.fastestFee ?? 5) * TYPICAL_VBYTES),
      medium: Math.ceil((data.halfHourFee ?? 3) * TYPICAL_VBYTES),
      slow: Math.ceil((data.hourFee ?? 1) * TYPICAL_VBYTES),
      timestamp: Date.now(),
    };
    cachedFees = fees;
    return fees;
  } catch (e) {
    console.warn('estimateOnchainFee failed:', e);
    // Fallback estimate
    return { fast: 700, medium: 420, slow: 140 };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function validateXpub(extPubKey: string): string | null {
  const trimmed = extPubKey.trim();
  if (!/^[xyzXYZ]pub[A-Za-z0-9]{100,112}$/.test(trimmed)) {
    return 'Invalid extended public key. Must start with xpub, ypub, or zpub.';
  }
  // Decode with bs58check so we validate both the base58 charset and the
  // checksum. A typo-ridden xpub that passes the shape regex would otherwise
  // throw later from toXpub() / Descriptor.create with a confusing native
  // error; catch it here and return a user-friendly message.
  try {
    const decoded = bs58check.decode(trimmed);
    // Must be 78 bytes: 4 version + 1 depth + 4 fingerprint + 4 child + 32 chain + 33 key.
    if (decoded.length !== 78) {
      return 'Invalid extended public key (wrong length after decode).';
    }
    const versionHex =
      byteToHex(decoded[0]) + byteToHex(decoded[1]) + byteToHex(decoded[2]) + byteToHex(decoded[3]);
    const isXpub = versionHex === '0488b21e';
    if (!isXpub && versionHex !== YPUB_HEX && versionHex !== ZPUB_HEX) {
      return 'Unsupported extended public key version (expected xpub/ypub/zpub).';
    }
  } catch {
    return 'Invalid extended public key (checksum or encoding error).';
  }
  return null;
}

export async function getNextReceiveAddress(walletId: string): Promise<string> {
  const wallet = await getBdkWallet(walletId);
  const info = await wallet.getAddress(AddressIndex.New);
  return await info.address.asString();
}

export async function getCurrentReceiveAddress(walletId: string): Promise<string> {
  const wallet = await getBdkWallet(walletId);
  const info = await wallet.getAddress(AddressIndex.LastUnused);
  return await info.address.asString();
}

/**
 * Sync once and return both balance and transactions.
 * Avoids double Electrum sync when fetching both.
 */
export async function syncAndRefresh(walletId: string): Promise<{
  balance: number | null;
  transactions: OnchainTransaction[];
  ok: boolean;
}> {
  try {
    const wallet = await getBdkWallet(walletId);
    const chain = await getBlockchain();
    await wallet.sync(chain);

    const bal = await wallet.getBalance();
    const txList = await wallet.listTransactions(false);

    return { balance: bal.total, transactions: mapAndSortTransactions(txList), ok: true };
  } catch (e) {
    // Return ok: false so callers can choose to keep their cached state
    // rather than overwriting it with empty values on transient Electrum
    // failures (the UI would otherwise flash to "No transactions").
    console.warn('onchainService.syncAndRefresh failed:', e);
    blockchain = null;
    return { balance: null, transactions: [], ok: false };
  }
}

export async function getBalance(walletId: string): Promise<number | null> {
  const result = await syncAndRefresh(walletId);
  return result.balance;
}

export async function getTransactions(walletId: string): Promise<OnchainTransaction[]> {
  try {
    const wallet = await getBdkWallet(walletId);
    const chain = await getBlockchain();
    await wallet.sync(chain);

    const txList = await wallet.listTransactions(false);

    return mapAndSortTransactions(txList);
  } catch (e) {
    console.warn('onchainService.getTransactions failed:', e);
    blockchain = null;
    return [];
  }
}

/** Check if a wallet is watch-only (no mnemonic stored). */
export async function isWatchOnly(walletId: string): Promise<boolean> {
  const mnemonic = await getMnemonic(walletId);
  return !mnemonic;
}

/**
 * Send on-chain Bitcoin from a hot wallet.
 * Only works for wallets with stored mnemonics (not watch-only).
 */
const MIN_FEE_RATE = 1;
const MAX_FEE_RATE = 500;

export async function sendTransaction(
  walletId: string,
  toAddress: string,
  amountSats: number,
  feeRate: number = 2,
): Promise<string> {
  const watchOnly = await isWatchOnly(walletId);
  if (watchOnly) {
    throw new Error('Cannot send from a watch-only wallet — no signing key available');
  }
  if (feeRate < MIN_FEE_RATE || feeRate > MAX_FEE_RATE) {
    throw new Error(
      `Fee rate must be between ${MIN_FEE_RATE} and ${MAX_FEE_RATE} sat/vB, got ${feeRate}`,
    );
  }

  const { TxBuilder, Address } = await import('bdk-rn');

  const wallet = await getBdkWallet(walletId);

  // Always create a fresh Electrum connection for sends to avoid stale state
  console.log('[BDK] sendTransaction: creating fresh Electrum connection');
  blockchain = null;
  const chain = await getBlockchain();
  console.log('[BDK] sendTransaction: syncing wallet');
  await wallet.sync(chain);
  console.log('[BDK] sendTransaction: sync complete');

  const address = await new Address().create(toAddress);
  const script = await address.scriptPubKey();

  let txBuilder = await new TxBuilder().create();
  txBuilder = await txBuilder.addRecipient(script, amountSats);
  txBuilder = await txBuilder.feeRate(feeRate);

  const result = await txBuilder.finish(wallet);
  const signedPsbt = await wallet.sign(result.psbt);
  const tx = await signedPsbt.extractTx();

  try {
    console.log('[BDK] sendTransaction: broadcasting');
    await chain.broadcast(tx);
    console.log('[BDK] sendTransaction: broadcast complete');
  } catch (e) {
    console.warn('sendTransaction: broadcast failed, reconnecting:', e);
    blockchain = null;
    const freshChain = await getBlockchain();
    await freshChain.broadcast(tx);
  }

  return await signedPsbt.txid();
}

export async function removeWallet(walletId: string): Promise<void> {
  bdkWallets.delete(walletId);
  await AsyncStorage.removeItem(`${ADDRESS_INDEX_PREFIX}${walletId}`);
}

export function disconnectElectrum(): void {
  blockchain = null;
}

/**
 * Drop the in-memory BDK wallet for `walletId` without touching storage.
 * Call this when the backing descriptor changes (e.g. mnemonic re-import)
 * so the next on-chain call rebuilds the wallet from the new secret
 * rather than signing with a stale cached key.
 */
export function invalidateWalletCache(walletId: string): void {
  bdkWallets.delete(walletId);
}

/**
 * Broadcast a raw transaction hex via the configured Electrum server.
 * Uses BDK's blockchain.broadcast which handles the Electrum protocol.
 */
export async function broadcastRawTx(txHex: string): Promise<void> {
  if (!txHex || txHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(txHex)) {
    throw new Error('Invalid transaction hex: must be a non-empty even-length hex string');
  }
  const { Transaction } = await import('bdk-rn');
  // Force a fresh Electrum connection. A stale/dropped socket can cause
  // broadcast() to fail in a way that masks the real error as a RN
  // DevSettings "Cannot read property 'reload' of undefined" crash. Matches
  // the pattern used in sendTransaction().
  blockchain = null;
  const chain = await getBlockchain();
  const bytes: number[] = [];
  for (let i = 0; i < txHex.length; i += 2) {
    bytes.push(parseInt(txHex.substring(i, i + 2), 16));
  }
  const tx = await new Transaction().create(bytes);
  await chain.broadcast(tx);
}
