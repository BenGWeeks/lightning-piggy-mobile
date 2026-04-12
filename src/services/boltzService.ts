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
import { keyAggregate, keyAggExport } from '@scure/btc-signer/musig2.js';

const bip32 = BIP32Factory(ecc);
const BOLTZ_API = 'https://api.boltz.exchange/v2';

// Boltz BTC swap limits (from API — these are fallback defaults)
export const BOLTZ_MIN_SATS = 25_000;
export const BOLTZ_MAX_SATS = 25_000_000;

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

// Boltz v2 swap statuses (from https://api.docs.boltz.exchange/lifecycle.html)
export type SwapStatus =
  // Shared
  | 'swap.created'
  | 'transaction.mempool'
  | 'transaction.confirmed'
  | 'swap.expired'
  // Submarine (on-chain → LN)
  | 'invoice.set'
  | 'invoice.pending'
  | 'invoice.paid'
  | 'invoice.failedToPay'
  | 'transaction.claim.pending'
  | 'transaction.claimed'
  | 'transaction.lockupFailed'
  // Reverse (LN → on-chain)
  | 'invoice.settled'
  | 'invoice.expired'
  | 'transaction.failed'
  | 'transaction.refunded';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Bitcoin CompactSize varint encoding for script lengths in tapleaf hashes. */
function compactSize(len: number): Buffer {
  if (len < 0xfd) return Buffer.from([len]);
  if (len <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(len, 1);
    return buf;
  }
  throw new Error(`Script too large for CompactSize: ${len}`);
}

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

/** Fetch with a timeout to prevent hanging on slow/unreachable APIs. */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch current reverse swap fee schedule (BTC Lightning → BTC on-chain).
 */
export async function getReverseSwapFees(): Promise<SwapFees> {
  const res = await fetchWithTimeout(`${BOLTZ_API}/swap/reverse`);
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
  const res = await fetchWithTimeout(`${BOLTZ_API}/swap/submarine`);
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
  console.log(
    `[Boltz] Creating reverse swap (LN → on-chain) for ${amountSats} sats to ${onchainAddress}`,
  );
  if (!isBitcoinAddress(onchainAddress)) {
    throw new Error('Invalid destination Bitcoin address');
  }

  // Generate preimage and its SHA-256 hash
  const preimageBytes = new Uint8Array(32);
  crypto.getRandomValues(preimageBytes);
  const preimage = toHex(preimageBytes);
  const preimageHashBytes = sha256(preimageBytes);
  const preimageHash = toHex(preimageHashBytes);

  // Generate temporary claim keypair
  const claimKeys = generateClaimKeyPair();
  const claimPublicKey = toHex(claimKeys.publicKey);

  const res = await fetchWithTimeout(`${BOLTZ_API}/swap/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BTC',
      to: 'BTC',
      preimageHash,
      claimPublicKey,
      claimAddress: onchainAddress,
      invoiceAmount: amountSats,
      referralId: 'lightning-piggy',
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Boltz swap creation failed: ${errBody}`);
  }

  const data = await res.json();
  console.log(
    `[Boltz] Reverse swap created: id=${data.id} lockup=${data.lockupAddress} onchainAmount=${data.onchainAmount}`,
  );
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

const BOLTZ_WS = 'wss://api.boltz.exchange/v2/ws';

/**
 * Subscribe to swap status updates via WebSocket, falling back to polling.
 * Calls onStatus for each status update until it returns true (terminal).
 */
async function waitForSwapStatus(
  swapId: string,
  isTerminal: (status: string, data: any) => boolean,
  timeoutMs: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`Timeout waiting for swap ${swapId} after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const cleanup = (ws?: WebSocket) => {
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
    };

    // Try WebSocket first
    try {
      const ws = new WebSocket(BOLTZ_WS);
      let wsConnected = false;

      ws.onopen = () => {
        wsConnected = true;
        ws.send(JSON.stringify({ op: 'subscribe', channel: 'swap.update', args: [swapId] }));
        console.log(`[Boltz] WebSocket subscribed to swap ${swapId}`);
      };

      ws.onmessage = (event) => {
        if (settled) return;
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
          if (msg.channel === 'swap.update' && msg.args?.[0]) {
            const data = msg.args[0];
            console.log(`[Boltz] WS swap ${swapId} status: ${data.status}`);
            if (isTerminal(data.status, data)) {
              settled = true;
              cleanup(ws);
              resolve(data);
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        if (!settled && !wsConnected) {
          console.warn('[Boltz] WebSocket failed, falling back to polling');
          cleanup(ws);
          // Fall back to polling
          pollSwapStatus(swapId, isTerminal, timeoutMs - (Date.now() % timeoutMs))
            .then(resolve)
            .catch(reject);
        }
      };

      ws.onclose = () => {
        if (!settled) {
          console.warn('[Boltz] WebSocket closed, falling back to polling');
          pollSwapStatus(swapId, isTerminal, timeoutMs - (Date.now() % timeoutMs))
            .then(resolve)
            .catch(reject);
        }
      };
    } catch {
      // WebSocket constructor failed — fall back to polling
      pollSwapStatus(swapId, isTerminal, timeoutMs).then(resolve).catch(reject);
    }
  });
}

/** Polling fallback for swap status. */
async function pollSwapStatus(
  swapId: string,
  isTerminal: (status: string, data: any) => boolean,
  timeoutMs: number,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetchWithTimeout(`${BOLTZ_API}/swap/${swapId}`);
    if (!res.ok) throw new Error(`Boltz status check failed: ${res.status}`);
    const data = await res.json();
    console.log(`[Boltz] Poll swap ${swapId} status: ${data.status}`);
    if (isTerminal(data.status, data)) return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timeout polling swap ${swapId}`);
}

/**
 * Wait for reverse swap lockup transaction to appear on-chain.
 * Uses WebSocket with polling fallback.
 */
export async function waitForLockup(
  swapId: string,
  timeoutMs: number = 60000,
): Promise<{ txId: string; vout: number; amount: number }> {
  console.log(`[Boltz] Waiting for reverse swap lockup: ${swapId} (timeout ${timeoutMs / 1000}s)`);

  const FAIL_STATUSES = [
    'swap.expired',
    'transaction.refunded',
    'transaction.failed',
    'invoice.expired',
  ];

  const data = await waitForSwapStatus(
    swapId,
    (status) => {
      if (status === 'transaction.mempool' || status === 'transaction.confirmed') return true;
      if (FAIL_STATUSES.includes(status)) throw new Error(`Swap failed with status: ${status}`);
      return false;
    },
    timeoutMs,
  );

  const txId = data.transaction?.id;
  const vout = data.transaction?.index;
  const amount = data.onchainAmount;

  if (typeof txId !== 'string' || txId.length === 0) {
    throw new Error(`Boltz lockup missing valid transaction.id for swap ${swapId}`);
  }
  if (!Number.isInteger(vout) || vout < 0) {
    throw new Error(`Boltz lockup missing valid transaction.index for swap ${swapId}`);
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Boltz lockup missing valid onchainAmount for swap ${swapId}`);
  }

  return { txId, vout, amount };
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
    Buffer.concat([Buffer.from([claimLeafVersion]), compactSize(claimScript.length), claimScript]),
  );
  const refundLeafHash = bitcoin.crypto.taggedHash(
    'TapLeaf',
    Buffer.concat([
      Buffer.from([refundLeafVersion]),
      compactSize(refundScript.length),
      refundScript,
    ]),
  );

  // Boltz v2 Taproot internal key is the MuSig2 aggregate of the claim
  // pubkey (ours) and the refund pubkey (theirs) — BIP-327. It is NOT just
  // the refund pubkey. Both inputs must be 33-byte compressed pubkeys.
  // See: https://docs.boltz.exchange and @scure/btc-signer musig2.
  const claimPubKeyCompressed = Buffer.from(ecc.pointFromScalar(claimPrivKey, true) as Uint8Array);
  const refundPubKeyCompressed =
    refundPubKey.length === 33
      ? refundPubKey
      : Buffer.from(
          ecc.xOnlyPointAddTweak(new Uint8Array(refundPubKey), new Uint8Array(32))!.xOnlyPubkey,
        );
  // Boltz v2 MuSig2 key aggregation: "Boltz's public key always coming first".
  // For reverse swaps Boltz is the refunder, so refund key is passed first,
  // then claim key (the user's). Confirmed against chain via p2tr diagnostic.
  // See https://api.docs.boltz.exchange/claiming-swaps.html
  const aggCtx = keyAggregate([
    new Uint8Array(refundPubKeyCompressed),
    new Uint8Array(claimPubKeyCompressed),
  ]);
  const internalKey = Buffer.from(keyAggExport(aggCtx));

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

  // Compute sighash for Taproot script-path (BIP-341, SIGHASH_DEFAULT)
  const prevOutScript = bitcoin.address.toOutputScript(swap.lockupAddress);
  const sighash = tx.hashForWitnessV1(
    0,
    [prevOutScript],
    [BigInt(lockup.amount)],
    0x00, // SIGHASH_DEFAULT — 64-byte sig, no sighash byte appended
    claimLeafHash,
  );

  // Schnorr sign — no sighash byte appended (SIGHASH_DEFAULT)
  const sig = Buffer.from(ecc.signSchnorr(new Uint8Array(sighash), new Uint8Array(claimPrivKey)));

  // Set witness: <sig> <preimage> <claim_script> <control_block>
  tx.setWitness(0, [sig, preimageBytes, claimScript, controlBlock]);

  // Broadcast via the configured Electrum server (BDK)
  const txId = tx.getId();
  console.log(`[Boltz] Broadcasting claim tx: ${txId} (${tx.toHex().length / 2} bytes)`);
  const onchainService = await import('./onchainService');
  await onchainService.broadcastRawTx(tx.toHex());
  console.log(`[Boltz] Claim tx broadcast successfully: ${txId}`);
  return txId;
}

/**
 * Validate that a string is a valid Bitcoin on-chain address (with checksum).
 * Uses bitcoinjs-lib's address.toOutputScript which validates format + checksum.
 */
export function isBitcoinAddress(input: string): boolean {
  const trimmed = input.trim();
  try {
    bitcoin.address.toOutputScript(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch lockup transaction details for a submarine swap.
 * Used to get the UTXO needed for refund transaction construction.
 */
export async function getSubmarineSwapLockup(
  swapId: string,
): Promise<{ txId: string; vout: number; amount: number } | null> {
  try {
    const res = await fetchWithTimeout(`${BOLTZ_API}/swap/submarine/${swapId}/transaction`);
    if (!res.ok) return null;
    const data = await res.json();
    const txId = data.transactionId ?? data.id;
    if (!txId) return null;
    // Fetch expected amount from swap status
    const statusRes = await fetchWithTimeout(`${BOLTZ_API}/swap/${swapId}`);
    if (!statusRes.ok) return null;
    const statusData = await statusRes.json();
    return {
      txId,
      vout: data.index ?? 0,
      amount: statusData.onchainAmount ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Build and broadcast a script-path refund transaction for a failed submarine swap.
 *
 * After the timeout block height, the user can reclaim their on-chain BTC
 * by spending the HTLC via the refund script path.
 */
export async function refundSwap(
  swap: SubmarineSwapResult,
  lockup: { txId: string; vout: number; amount: number },
  destinationAddress: string,
  feeRate: number = 2,
): Promise<string> {
  console.log(`[Boltz] Building refund tx for swap ${swap.id} to ${destinationAddress}`);

  const refundScript = Buffer.from(swap.swapTree.refundLeaf.output, 'hex');
  const claimScript = Buffer.from(swap.swapTree.claimLeaf.output, 'hex');
  const refundPrivKey = Buffer.from(swap.refundPrivateKey, 'hex');
  const claimPubKey = Buffer.from(swap.claimPublicKey, 'hex');
  const refundLeafVersion = swap.swapTree.refundLeaf.version ?? 0xc0;
  const claimLeafVersion = swap.swapTree.claimLeaf.version ?? 0xc0;

  const fee = Math.ceil(150 * feeRate);
  const outputAmount = lockup.amount - fee;
  if (outputAmount <= 546) {
    throw new Error(`Refund amount (${lockup.amount}) too small after fee (${fee})`);
  }

  // Build transaction with nLockTime for timelock
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = swap.timeoutBlockHeight;
  // Sequence 0xFFFFFFFE enables nLockTime (BIP-125 RBF compatible)
  tx.addInput(Buffer.from(lockup.txId, 'hex').reverse(), lockup.vout, 0xfffffffe);
  tx.addOutput(bitcoin.address.toOutputScript(destinationAddress), BigInt(outputAmount));

  // Compute tapleaf hashes (same as claimSwap but we spend refundLeaf)
  const refundLeafHash = bitcoin.crypto.taggedHash(
    'TapLeaf',
    Buffer.concat([
      Buffer.from([refundLeafVersion]),
      compactSize(refundScript.length),
      refundScript,
    ]),
  );
  const claimLeafHash = bitcoin.crypto.taggedHash(
    'TapLeaf',
    Buffer.concat([Buffer.from([claimLeafVersion]), compactSize(claimScript.length), claimScript]),
  );

  // Internal key: x-only Boltz claim public key (they are the internal key for submarine swaps)
  const internalKey = claimPubKey.length === 33 ? claimPubKey.subarray(1) : claimPubKey;

  // Merkle root (sorted)
  const merkleRoot =
    Buffer.compare(claimLeafHash, refundLeafHash) < 0
      ? bitcoin.crypto.taggedHash('TapBranch', Buffer.concat([claimLeafHash, refundLeafHash]))
      : bitcoin.crypto.taggedHash('TapBranch', Buffer.concat([refundLeafHash, claimLeafHash]));

  const tweak = bitcoin.crypto.taggedHash('TapTweak', Buffer.concat([internalKey, merkleRoot]));
  const tweakedKey = ecc.xOnlyPointAddTweak(new Uint8Array(internalKey), new Uint8Array(tweak));
  if (!tweakedKey) throw new Error('Failed to compute tweaked key for refund');
  const parityBit = tweakedKey.parity;

  // Control block: refund leaf version | parity, internal key, claim leaf hash (merkle sibling)
  const controlBlock = Buffer.concat([
    Buffer.from([refundLeafVersion | parityBit]),
    internalKey,
    claimLeafHash,
  ]);

  // Sighash for Taproot script-path
  const prevOutScript = bitcoin.address.toOutputScript(swap.address);
  const sighash = tx.hashForWitnessV1(
    0,
    [prevOutScript],
    [BigInt(lockup.amount)],
    0x00, // SIGHASH_DEFAULT
    refundLeafHash,
  );

  const sig = ecc.signSchnorr(new Uint8Array(sighash), new Uint8Array(refundPrivKey));

  // Witness: <sig> <refund_script> <control_block> (no preimage for refund)
  tx.setWitness(0, [Buffer.from(sig), refundScript, controlBlock]);

  const txId = tx.getId();
  console.log(`[Boltz] Broadcasting refund tx: ${txId}`);
  const onchainService = await import('./onchainService');
  await onchainService.broadcastRawTx(tx.toHex());
  console.log(`[Boltz] Refund tx broadcast successfully: ${txId}`);
  return txId;
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
  /** Refund private key (hex) — needed if swap fails and we need to reclaim on-chain funds */
  refundPrivateKey: string;
  /** Boltz's claim public key (hex) — Taproot internal key for refund tree */
  claimPublicKey: string;
  /** Swap tree for script-path refund */
  swapTree: SwapTree;
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
export async function createSubmarineSwapForward(invoice: string): Promise<SubmarineSwapResult> {
  console.log('[Boltz] Creating submarine swap (on-chain → LN)');
  const refundKeys = generateClaimKeyPair();

  const res = await fetchWithTimeout(`${BOLTZ_API}/swap/submarine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BTC',
      to: 'BTC',
      invoice,
      refundPublicKey: toHex(refundKeys.publicKey),
      referralId: 'lightning-piggy',
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Boltz submarine swap creation failed: ${errBody}`);
  }

  const data = await res.json();
  console.log(
    `[Boltz] Submarine swap created: id=${data.id} address=${data.address} amount=${data.expectedAmount}`,
  );
  return {
    id: data.id,
    address: data.address,
    expectedAmount: data.expectedAmount,
    timeoutBlockHeight: data.timeoutBlockHeight ?? 0,
    refundPrivateKey: toHex(refundKeys.privateKey),
    claimPublicKey: data.claimPublicKey ?? '',
    swapTree: data.swapTree,
  };
}

/**
 * Poll submarine swap status until Boltz has paid the Lightning invoice.
 */
export async function waitForSubmarineSwapComplete(
  swapId: string,
  timeoutMs: number = 120000,
): Promise<void> {
  console.log(
    `[Boltz] Waiting for submarine swap completion: ${swapId} (timeout ${timeoutMs / 1000}s)`,
  );

  const FAIL_STATUSES = [
    'swap.expired',
    'transaction.refunded',
    'invoice.failedToPay',
    'transaction.lockupFailed',
  ];

  await waitForSwapStatus(
    swapId,
    (status) => {
      if (
        status === 'invoice.settled' ||
        status === 'transaction.claimed' ||
        status === 'invoice.paid' ||
        status === 'transaction.claim.pending'
      ) {
        console.log(`[Boltz] Submarine swap ${swapId} complete: ${status}`);
        return true;
      }
      if (FAIL_STATUSES.includes(status)) {
        throw new Error(`Swap failed with status: ${status}`);
      }
      return false;
    },
    timeoutMs,
  );
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
