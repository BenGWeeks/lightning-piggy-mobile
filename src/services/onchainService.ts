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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnchainTransaction {
  txid: string;
  type: 'incoming' | 'outgoing';
  amount: number;
  confirmed: boolean;
  blockHeight: number | null;
  timestamp: number | null;
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
    validateDomain: false,
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

// ─── Public API ───────────────────────────────────────────────────────────────

export function validateXpub(extPubKey: string): string | null {
  const trimmed = extPubKey.trim();
  if (!/^[xyzXYZ]pub[A-Za-z0-9]{100,112}$/.test(trimmed)) {
    return 'Invalid extended public key. Must start with xpub, ypub, or zpub.';
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
export async function syncAndRefresh(
  walletId: string,
): Promise<{ balance: number | null; transactions: OnchainTransaction[] }> {
  try {
    const wallet = await getBdkWallet(walletId);
    const chain = await getBlockchain();
    await wallet.sync(chain);

    const bal = await wallet.getBalance();
    const txList = await wallet.listTransactions(false);

    const transactions = txList
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

    return { balance: bal.total, transactions };
  } catch (e) {
    console.warn('onchainService.syncAndRefresh failed:', e);
    blockchain = null;
    return { balance: null, transactions: [] };
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
export async function sendTransaction(
  walletId: string,
  toAddress: string,
  amountSats: number,
  feeRate: number = 2,
): Promise<string> {
  const { TxBuilder, Address } = await import('bdk-rn');

  const wallet = await getBdkWallet(walletId);
  const chain = await getBlockchain();
  await wallet.sync(chain);

  const address = await new Address().create(toAddress);
  const script = await address.scriptPubKey();

  let txBuilder = await new TxBuilder().create();
  txBuilder = await txBuilder.addRecipient(script, amountSats);
  txBuilder = await txBuilder.feeRate(feeRate);

  const result = await txBuilder.finish(wallet);
  const signedPsbt = await wallet.sign(result.psbt);
  const tx = await signedPsbt.extractTx();
  await chain.broadcast(tx);

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
 * Broadcast a raw transaction hex via the configured Electrum server.
 * Uses BDK's blockchain.broadcast which handles the Electrum protocol.
 */
export async function broadcastRawTx(txHex: string): Promise<void> {
  const { Transaction } = await import('bdk-rn');
  const chain = await getBlockchain();
  // Convert hex string to byte array for BDK
  const bytes: number[] = [];
  for (let i = 0; i < txHex.length; i += 2) {
    bytes.push(parseInt(txHex.substring(i, i + 2), 16));
  }
  const tx = await new Transaction().create(bytes);
  await chain.broadcast(tx);
}
