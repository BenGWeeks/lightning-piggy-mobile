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
export async function getReverseSwapFees(): Promise<SwapFees> {
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

/** @deprecated Use getReverseSwapFees instead */
export const getSwapFees = getReverseSwapFees;

/**
 * Fetch current submarine swap fee schedule (BTC on-chain → BTC Lightning).
 */
export async function getSubmarineSwapFees(): Promise<SwapFees> {
  const res = await fetch(`${BOLTZ_API}/swap/submarine`);
  if (!res.ok) throw new Error(`Boltz API error: ${res.status}`);
  const data = await res.json();

  const pair = data?.BTC?.BTC;
  if (!pair) throw new Error('BTC/BTC pair not found in Boltz response');

  return {
    percentage: pair.fees?.percentage ?? 0.5,
    minerFee: pair.fees?.minerFees ?? 0,
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
      const txId = data.transaction?.id;
      const amount = data.onchainAmount;
      if (!txId || !amount) {
        throw new Error(`Boltz lockup missing transaction data: txId=${txId}, amount=${amount}`);
      }
      return {
        txId,
        vout: data.transaction?.index ?? 0,
        amount,
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
 * Build and broadcast a script-path claim transaction for a reverse swap.
 *
 * After Boltz locks BTC on-chain in a Taproot HTLC, we claim it by
 * revealing the preimage and signing with our claim key via script-path.
 */
export async function claimSwap(
  swap: ReverseSwapResult,
  lockup: { txId: string; vout: number; amount: number },
  destinationAddress: string,
  feeRate: number = 2,
): Promise<string> {
  // Use ecc (already imported) for Schnorr signing

  const claimScript = Buffer.from(swap.swapTree.claimLeaf.output, 'hex');
  const refundScript = Buffer.from(swap.swapTree.refundLeaf.output, 'hex');
  const claimPrivKey = Buffer.from(swap.claimPrivateKey, 'hex');
  const preimageBytes = Buffer.from(swap.preimage, 'hex');
  const refundPubKey = Buffer.from(swap.refundPublicKey, 'hex');
  const claimLeafVersion = swap.swapTree.claimLeaf.version ?? 0xc0;
  const refundLeafVersion = swap.swapTree.refundLeaf.version ?? 0xc0;

  // Estimate fee (~150 vbytes for 1-in-1-out Taproot script-path)
  const fee = Math.ceil(150 * feeRate);
  const outputAmount = lockup.amount - fee;
  if (outputAmount <= 546) {
    throw new Error(`Claim amount (${lockup.amount}) too small after fee (${fee})`);
  }

  // Build transaction
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(lockup.txId, 'hex').reverse(), lockup.vout, 0xfffffffd);
  tx.addOutput(bitcoin.address.toOutputScript(destinationAddress), BigInt(outputAmount));

  // Compute tapleaf hashes
  const claimLeafHash = bitcoin.crypto.taggedHash(
    'TapLeaf',
    Buffer.concat([
      Buffer.from([claimLeafVersion]),
      Buffer.concat([Buffer.from([claimScript.length]), claimScript]),
    ]),
  );
  const refundLeafHash = bitcoin.crypto.taggedHash(
    'TapLeaf',
    Buffer.concat([
      Buffer.from([refundLeafVersion]),
      Buffer.concat([Buffer.from([refundScript.length]), refundScript]),
    ]),
  );

  // x-only internal key (Boltz's refund pubkey)
  const internalKey = refundPubKey.length === 33 ? refundPubKey.subarray(1) : refundPubKey;

  // Compute the Taproot tweak to determine output key parity (BIP-341)
  // Merkle root: sort and hash the two leaf hashes
  const merkleRoot =
    Buffer.compare(claimLeafHash, refundLeafHash) < 0
      ? bitcoin.crypto.taggedHash('TapBranch', Buffer.concat([claimLeafHash, refundLeafHash]))
      : bitcoin.crypto.taggedHash('TapBranch', Buffer.concat([refundLeafHash, claimLeafHash]));

  // Compute the tweak: taggedHash('TapTweak', internalKey || merkleRoot)
  const tweak = bitcoin.crypto.taggedHash('TapTweak', Buffer.concat([internalKey, merkleRoot]));

  // Derive the tweaked public key to get the output parity bit
  const tweakedKey = ecc.xOnlyPointAddTweak(new Uint8Array(internalKey), new Uint8Array(tweak));
  if (!tweakedKey) throw new Error('Failed to compute tweaked key');
  const parityBit = tweakedKey.parity;

  // Control block: <leaf_version | parity> <internal_key> <merkle_sibling>
  const controlBlock = Buffer.concat([
    Buffer.from([claimLeafVersion | parityBit]),
    internalKey,
    refundLeafHash, // merkle proof (sibling of claim leaf)
  ]);

  // Compute sighash for Taproot script-path (BIP-341)
  const prevOutScript = bitcoin.address.toOutputScript(swap.lockupAddress);
  const sighash = tx.hashForWitnessV1(
    0,
    [prevOutScript],
    [BigInt(lockup.amount)],
    0x01, // SIGHASH_ALL
    claimLeafHash,
  );

  // Schnorr sign using @bitcoinerlab/secp256k1
  const sig = ecc.signSchnorr(new Uint8Array(sighash), new Uint8Array(claimPrivKey));
  const sigWithType = Buffer.concat([Buffer.from(sig), Buffer.from([0x01])]);

  // Set witness: <sig> <preimage> <claim_script> <control_block>
  tx.setWitness(0, [sigWithType, preimageBytes, claimScript, controlBlock]);

  // Broadcast via the configured Electrum server (BDK)
  const onchainService = await import('./onchainService');
  await onchainService.broadcastRawTx(tx.toHex());
  return tx.getId();
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

// ─── Submarine swap (on-chain → Lightning) ───────────────────────────────────

export interface SubmarineSwapResult {
  id: string;
  /** On-chain address the user must send BTC to */
  address: string;
  /** Expected amount in sats to send on-chain (includes Boltz fee) */
  expectedAmount: number;
  /** Timeout block height — refund possible after this */
  timeoutBlockHeight: number;
}

/**
 * Create a submarine swap: on-chain → Lightning.
 *
 * Flow:
 *   1. Generate an LN invoice on the destination NWC wallet (caller does this)
 *   2. Create swap with Boltz, providing the invoice
 *   3. Boltz returns an on-chain address + expected amount
 *   4. Send BTC on-chain to that address from the hot wallet (caller does this)
 *   5. Boltz detects the on-chain payment and pays the LN invoice
 */
export async function createSubmarineSwapForward(
  invoice: string,
): Promise<SubmarineSwapResult> {
  // Generate a refund keypair — needed if swap fails and we need refund
  const refundKeys = generateClaimKeyPair();

  const res = await fetch(`${BOLTZ_API}/swap/submarine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BTC',
      to: 'BTC',
      invoice,
      refundPublicKey: toHex(refundKeys.publicKey),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Boltz submarine swap creation failed: ${errBody}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    address: data.address,
    expectedAmount: data.expectedAmount,
    timeoutBlockHeight: data.timeoutBlockHeight ?? 0,
  };
}

/**
 * Poll submarine swap status until Boltz has paid the Lightning invoice.
 */
export async function waitForSubmarineSwapComplete(
  swapId: string,
  timeoutMs: number = 120000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BOLTZ_API}/swap/submarine/${swapId}`);
    if (!res.ok) throw new Error(`Boltz status check failed: ${res.status}`);
    const data = await res.json();

    if (data.status === 'invoice.settled' || data.status === 'transaction.claimed') {
      return;
    }

    if (
      data.status === 'swap.expired' ||
      data.status === 'swap.refunded' ||
      data.status === 'invoice.failedToPay'
    ) {
      throw new Error(`Swap failed with status: ${data.status}`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error('Timeout waiting for Boltz to pay Lightning invoice');
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
