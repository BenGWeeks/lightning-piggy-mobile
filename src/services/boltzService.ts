/**
 * Boltz Exchange reverse submarine swap service.
 *
 * Enables sending from Lightning to on-chain Bitcoin addresses using
 * Boltz v2 reverse swaps with script-path (non-cooperative) claiming.
 *
 * Flow:
 *   1. Generate preimage + claim keypair
 *   2. Create reverse swap via Boltz API (returns LN invoice + lockup details)
 *   3. User pays the Lightning invoice via NWC
 *   4. Boltz locks BTC on-chain in a Taproot HTLC
 *   5. We construct a script-path claim transaction (sig + preimage)
 *   6. Broadcast claim tx → funds arrive at destination address
 *
 * Uses script-path spending (not cooperative MuSig2 key-path) to avoid
 * needing MuSig2 nonce exchange. Slightly larger on-chain footprint but
 * works with pure JS crypto (@noble/curves Schnorr + @scure/btc-signer).
 *
 * API docs: https://docs.boltz.exchange
 */

import * as ecc from '@bitcoinerlab/secp256k1';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { getElectrumServer } from './walletStorageService';

const bip32 = BIP32Factory(ecc);
const BOLTZ_API = 'https://api.boltz.exchange/v2';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwapFees {
  percentage: number;
  minerFee: number;
  minAmount: number;
  maxAmount: number;
}

export interface ReverseSwapResult {
  id: string;
  /** Lightning invoice the user must pay via NWC */
  invoice: string;
  /** On-chain amount Boltz will lock (after their fees) */
  onchainAmount: number;
  timeoutBlockHeight: number;
  /** Hex-encoded lockup address */
  lockupAddress: string;
  /** Boltz's refund public key (hex) */
  refundPublicKey: string;
  /** Serialized swap tree for script-path spending */
  swapTree: SwapTree;
  /** Our preimage (hex) — needed to claim */
  preimage: string;
  /** Our claim private key (hex) — needed to sign the claim tx */
  claimPrivateKey: string;
}

interface SwapTree {
  claimLeaf: { version: number; output: string };
  refundLeaf: { version: number; output: string };
}

export type SwapStatus =
  | 'swap.created'
  | 'transaction.mempool'
  | 'transaction.confirmed'
  | 'invoice.set'
  | 'invoice.pending'
  | 'invoice.paid'
  | 'invoice.settled'
  | 'transaction.claimed'
  | 'swap.expired'
  | 'swap.refunded';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHex(arr: Uint8Array): string {
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hash using bitcoinjs-lib's crypto (already works in RN) */
function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(bitcoin.crypto.sha256(Buffer.from(data)));
}

/** Generate a claim keypair using bip32 */
function generateClaimKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const node = bip32.fromSeed(Buffer.from(seed));
  return {
    privateKey: new Uint8Array(node.privateKey!),
    publicKey: new Uint8Array(node.publicKey),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch current reverse swap fee schedule (BTC Lightning → BTC on-chain).
 */
export async function getSwapFees(): Promise<SwapFees> {
  const res = await fetch(`${BOLTZ_API}/swap/reverse`);
  if (!res.ok) throw new Error(`Boltz API error: ${res.status}`);
  const data = await res.json();

  const pair = data?.BTC?.BTC;
  if (!pair) throw new Error('BTC/BTC pair not found in Boltz response');

  return {
    percentage: pair.fees?.percentage ?? 0.5,
    minerFee: pair.fees?.minerFees?.claim ?? pair.fees?.minerFees ?? 0,
    minAmount: pair.limits?.minimal ?? 10000,
    maxAmount: pair.limits?.maximal ?? 25000000,
  };
}

/**
 * Calculate the total fee for a reverse swap of a given amount.
 */
export function calculateSwapFee(amountSats: number, fees: SwapFees): number {
  return Math.ceil(amountSats * (fees.percentage / 100)) + fees.minerFee;
}

/**
 * Create a reverse submarine swap: Lightning → on-chain.
 *
 * Returns swap details including the Lightning invoice to pay and the
 * data needed to later claim the on-chain funds.
 */
export async function createReverseSwap(
  onchainAddress: string,
  amountSats: number,
): Promise<ReverseSwapResult> {
  // Generate preimage and its SHA-256 hash
  const preimageBytes = new Uint8Array(32);
  crypto.getRandomValues(preimageBytes);
  const preimage = toHex(preimageBytes);
  const preimageHashBytes = sha256(preimageBytes);
  const preimageHash = toHex(preimageHashBytes);

  // Generate temporary claim keypair
  const claimKeys = generateClaimKeyPair();
  const claimPublicKey = toHex(claimKeys.publicKey);

  const res = await fetch(`${BOLTZ_API}/swap/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BTC',
      to: 'BTC',
      preimageHash,
      claimPublicKey,
      claimAddress: onchainAddress,
      invoiceAmount: amountSats,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Boltz swap creation failed: ${errBody}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    invoice: data.invoice,
    onchainAmount: data.onchainAmount ?? amountSats,
    timeoutBlockHeight: data.timeoutBlockHeight ?? 0,
    lockupAddress: data.lockupAddress ?? '',
    refundPublicKey: data.refundPublicKey ?? '',
    swapTree: data.swapTree,
    preimage,
    claimPrivateKey: toHex(claimKeys.privateKey),
  };
}

/**
 * Poll swap status until the lockup transaction appears on-chain.
 * Returns the lockup transaction details when found.
 */
export async function waitForLockup(
  swapId: string,
  timeoutMs: number = 60000,
): Promise<{ txId: string; vout: number; amount: number }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BOLTZ_API}/swap/reverse/${swapId}`);
    if (!res.ok) throw new Error(`Boltz status check failed: ${res.status}`);
    const data = await res.json();

    if (data.status === 'transaction.mempool' || data.status === 'transaction.confirmed') {
      return {
        txId: data.transaction?.id ?? '',
        vout: data.transaction?.index ?? 0,
        amount: data.onchainAmount ?? 0,
      };
    }

    if (data.status === 'swap.expired' || data.status === 'swap.refunded') {
      throw new Error(`Swap failed with status: ${data.status}`);
    }

    // Wait 3 seconds before polling again
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error('Timeout waiting for Boltz lockup transaction');
}

/**
 * Broadcast a raw transaction via mempool.space API.
 */
export async function broadcastTransaction(txHex: string): Promise<string> {
  const base = await getElectrumServer();
  const res = await fetch(`${base}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Broadcast failed: ${errBody}`);
  }

  return res.text(); // Returns txid
}

/**
 * Validate that a string looks like a Bitcoin on-chain address.
 */
export function isBitcoinAddress(input: string): boolean {
  const trimmed = input.trim();
  if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  if (/^bc1[a-zA-HJ-NP-Z0-9]{25,62}$/i.test(trimmed)) return true;
  return false;
}

// ─── Legacy alias for backward compatibility ──────────────────────────────────

/** @deprecated Use createReverseSwap instead */
export const createSubmarineSwap = async (
  onchainAddress: string,
  amountSats: number,
): Promise<{ id: string; invoice: string; expectedAmount: number }> => {
  const swap = await createReverseSwap(onchainAddress, amountSats);
  return {
    id: swap.id,
    invoice: swap.invoice,
    expectedAmount: swap.onchainAmount,
  };
};
