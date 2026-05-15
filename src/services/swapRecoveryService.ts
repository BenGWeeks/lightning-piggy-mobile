/**
 * Swap recovery service.
 *
 * On app startup, scans SecureStore for persisted Boltz swap state and
 * resumes any swaps that are claimable. This prevents loss of funds when
 * a reverse swap's pay_invoice timeout caused the app to abort before
 * reaching the claim step.
 */

import * as SecureStore from 'expo-secure-store';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import Toast from '../components/BrandedToast';
import * as boltzService from './boltzService';

// Required for bitcoinjs-lib to derive output scripts from taproot (bech32m)
// addresses — lockup addresses are taproot, so without this toOutputScript
// throws "No ECC Library provided".
bitcoin.initEccLib(ecc);

/** Shape of the transaction-row data this module needs to classify a row as
 *  a Boltz swap. Kept structural (not importing WalletTransaction) so the
 *  service stays free of UI-layer types. */
export interface BoltzTransactionLike {
  swapId?: string;
  description?: string;
  paymentHash?: string;
}

/** Returns true when a transaction row originated from a Boltz reverse or
 *  submarine swap. Used by TransactionList and TransactionDetailSheet to
 *  decide whether to show Boltz-specific badges (yellow attention / green
 *  done) and the swap explanation block. Settled swaps drop `swapId` in
 *  some wallet backends, so we also match Boltz-minted invoice memos. */
export function isBoltzTransaction(tx: BoltzTransactionLike | null | undefined): boolean {
  if (!tx) return false;
  if (tx.swapId) return true;
  if (tx.description) {
    if (/boltz swap/i.test(tx.description)) return true;
    if (/send to btc|send to bitcoin/i.test(tx.description)) return true;
    if (/receive from btc|receive from bitcoin/i.test(tx.description)) return true;
  }
  return false;
}

function paymentHashFromPreimage(preimageHex: string): string {
  return bytesToHex(sha256(hexToBytes(preimageHex)));
}

// In-memory set of payment hashes for swaps that `recoverPendingSwaps` found
// in a "claimable but not yet successfully claimed" state — i.e. Boltz has
// locked funds on-chain but our claim either failed or can't be attempted.
// TransactionList subscribes via `subscribeAttention` and badges the matching
// row yellow. Cleared when a subsequent recovery run succeeds or the swap
// reaches a terminal state.
const attentionPaymentHashes = new Set<string>();
const attentionListeners = new Set<() => void>();

function notifyAttention(): void {
  for (const cb of attentionListeners) {
    try {
      cb();
    } catch (e) {
      console.warn('[SwapRecovery] attention listener threw:', e);
    }
  }
}

/** Snapshot of payment hashes whose swap needs user attention right now.
 *  Returned as a plain Set so consumers can call `.has(tx.paymentHash)` per
 *  row without copying. Mutating this set externally is not supported. */
export function getAttentionPaymentHashes(): ReadonlySet<string> {
  return attentionPaymentHashes;
}

/** Subscribe to changes in the attention set. Returns an unsubscribe fn. */
export function subscribeAttention(cb: () => void): () => void {
  attentionListeners.add(cb);
  return () => {
    attentionListeners.delete(cb);
  };
}

// LRU-capped, SecureStore-persisted cache of payment hashes whose on-chain
// claim has been observed to succeed — either via our own synchronous
// `boltzService.claimSwap` (SendSheet / TransferSheet / recoverSwap) or via
// a Boltz API terminal-success status (`invoice.settled` / `transaction.
// claimed`). Used by TransactionList to synthesise the 'done' green tick
// on settled OUTGOING reverse-swap rows; incoming swaps don't consult it
// (LN-settled implies done for incoming).
//
// `Map<paymentHash, claimTxId | null>` instead of a Set so we can both
// (a) answer `has(...)` for the badge predicate and (b) surface the
// claim txid in TransactionDetailSheet + the Boltz support email. The
// value is `null` when we know the claim succeeded but didn't perform
// it ourselves (terminal-success poll), so the txid isn't available.
//
// Map preserves insertion order in JS, which is the property we lean on
// for LRU eviction: when size exceeds `CLAIMED_CAP`, we delete the first
// key — the least-recently-inserted hash. 500 is comfortably above any
// realistic LP user's lifetime reverse-swap count.
const CLAIMED_CAP = 500;
const SWAP_CLAIMED_KEY = 'boltz_claimed_hashes_v1';
const claimedPaymentHashes = new Map<string, string | null>();
let claimedHashesLoaded = false;
const claimedListeners = new Set<() => void>();

function notifyClaimed(): void {
  for (const cb of claimedListeners) {
    try {
      cb();
    } catch (e) {
      console.warn('[SwapRecovery] claimed listener threw:', e);
    }
  }
}

async function loadClaimedHashes(): Promise<void> {
  if (claimedHashesLoaded) return;
  claimedHashesLoaded = true;
  try {
    const raw = await SecureStore.getItemAsync(SWAP_CLAIMED_KEY);
    if (!raw) return;
    // Persisted shape: Array<[paymentHash, claimTxId | null]> — oldest first.
    const arr = JSON.parse(raw) as [string, string | null][];
    for (const [hash, txid] of arr) claimedPaymentHashes.set(hash, txid);
    // Defensive trim in case CLAIMED_CAP was lowered in a future release.
    while (claimedPaymentHashes.size > CLAIMED_CAP) {
      const oldest = claimedPaymentHashes.keys().next().value;
      if (oldest === undefined) break;
      claimedPaymentHashes.delete(oldest);
    }
    notifyClaimed();
  } catch (e) {
    console.warn('[SwapRecovery] Failed to load claimed hashes:', e);
  }
}

// Eager-load so renders soon after import get accurate badges.
loadClaimedHashes();

/** Returns true if the on-chain claim for this payment hash has been
 *  observed to succeed (either via our own claim broadcast or a Boltz
 *  terminal-success poll). Used to gate the 'done' badge for OUTGOING
 *  reverse swaps — see TransactionList.iconStateFor. */
export function hasClaimedPaymentHash(paymentHash: string): boolean {
  return claimedPaymentHashes.has(paymentHash);
}

/** Returns the broadcast claim txid for this payment hash, or null when
 *  the claim succeeded but we don't have the txid (terminal-success poll
 *  path). Returns undefined when the hash isn't in the cache at all. */
export function getClaimTxId(paymentHash: string): string | null | undefined {
  return claimedPaymentHashes.get(paymentHash);
}

/** Subscribe to changes in the claimed-hash cache. Returns an unsubscribe fn. */
export function subscribeClaimed(cb: () => void): () => void {
  claimedListeners.add(cb);
  return () => {
    claimedListeners.delete(cb);
  };
}

/** Record a successful claim. `claimTxId` is the broadcast txid for
 *  claims we performed ourselves; pass `null` for terminal-success polls
 *  where Boltz reports completion but we don't have the txid. Adding an
 *  existing key bumps its LRU recency. Persists fire-and-forget. */
export async function recordClaimedPaymentHash(
  paymentHash: string,
  claimTxId: string | null,
): Promise<void> {
  await loadClaimedHashes();
  const wasPresent = claimedPaymentHashes.has(paymentHash);
  // delete + set so insertion order reflects recency (LRU semantics).
  claimedPaymentHashes.delete(paymentHash);
  claimedPaymentHashes.set(paymentHash, claimTxId);
  while (claimedPaymentHashes.size > CLAIMED_CAP) {
    const oldest = claimedPaymentHashes.keys().next().value;
    if (oldest === undefined) break;
    claimedPaymentHashes.delete(oldest);
  }
  // Notify on insertion OR when an existing entry's txid changed
  // (e.g. terminal-success record gets supplemented by a later claim).
  const txidChanged = wasPresent && claimedPaymentHashes.get(paymentHash) !== claimTxId;
  if (!wasPresent || txidChanged) notifyClaimed();
  // Fire-and-forget — the next pass tolerates a slightly stale on-disk
  // snapshot; an in-memory hash that hasn't been persisted yet still
  // shows the green tick this session.
  SecureStore.setItemAsync(
    SWAP_CLAIMED_KEY,
    JSON.stringify(Array.from(claimedPaymentHashes.entries())),
  ).catch((e) => console.warn('[SwapRecovery] Failed to save claimed hashes:', e));
}

/** Convenience for callers (SendSheet / TransferSheet) that have the
 *  preimage rather than the derived payment hash. */
export async function recordClaimedFromPreimage(
  preimageHex: string,
  claimTxId: string | null,
): Promise<void> {
  return recordClaimedPaymentHash(paymentHashFromPreimage(preimageHex), claimTxId);
}

/**
 * Boltz v2 /swap/{id} returns only transaction.id + transaction.hex — not
 * vout/onchainAmount. Parse the raw tx to find the output that matches our
 * lockup address.
 */
function extractLockupFromTxHex(
  txHex: string,
  lockupAddress: string,
): { vout: number; amount: number } | null {
  try {
    const tx = bitcoin.Transaction.fromHex(txHex);
    const expectedScript = bitcoin.address.toOutputScript(lockupAddress);
    for (let i = 0; i < tx.outs.length; i++) {
      const script = tx.outs[i].script;
      if (
        script.length === expectedScript.length &&
        script.every((b, j) => b === expectedScript[j])
      ) {
        return { vout: i, amount: Number(tx.outs[i].value) };
      }
    }
    return null;
  } catch (e) {
    console.warn('[SwapRecovery] Failed to parse lockup tx hex:', e);
    return null;
  }
}

const BOLTZ_API = 'https://api.boltz.exchange/v2';

interface PersistedReverseSwap {
  id: string;
  preimage: string;
  claimPrivateKey: string;
  lockupAddress: string;
  destinationAddress: string;
  refundPublicKey?: string;
  swapTree?: {
    claimLeaf: { version: number; output: string };
    refundLeaf: { version: number; output: string };
  };
}

/**
 * List all persisted reverse swap IDs from SecureStore by trying common
 * key patterns. SecureStore doesn't expose a listing API so we have to
 * track keys ourselves. We use a separate index key for this.
 */
const SWAP_INDEX_KEY = 'boltz_swap_index';

// Serialise read-modify-write of the swap index so two concurrent callers
// (e.g. two swaps created back-to-back) cannot clobber each other's entries.
// A dropped entry would leave a stranded swap that swapRecoveryService never
// retries, so Boltz auto-refunds at timeout and the user loses the funds.
// Each call chains onto `indexMutex`; failures are caught inside each op so
// one bad write doesn't poison the chain for subsequent callers.
let indexMutex: Promise<void> = Promise.resolve();

function withIndexLock<T>(op: () => Promise<T>): Promise<T> {
  const run = indexMutex.then(op, op);
  indexMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function registerPendingSwap(swapId: string): Promise<void> {
  return withIndexLock(async () => {
    try {
      const existing = await SecureStore.getItemAsync(SWAP_INDEX_KEY);
      const ids = existing ? (JSON.parse(existing) as string[]) : [];
      if (!ids.includes(swapId)) {
        ids.push(swapId);
        await SecureStore.setItemAsync(SWAP_INDEX_KEY, JSON.stringify(ids));
      }
    } catch (e) {
      console.warn('[SwapRecovery] Failed to register swap:', e);
    }
  });
}

export async function unregisterPendingSwap(swapId: string): Promise<void> {
  return withIndexLock(async () => {
    try {
      const existing = await SecureStore.getItemAsync(SWAP_INDEX_KEY);
      if (!existing) return;
      const ids = (JSON.parse(existing) as string[]).filter((id) => id !== swapId);
      await SecureStore.setItemAsync(SWAP_INDEX_KEY, JSON.stringify(ids));
    } catch (e) {
      console.warn('[SwapRecovery] Failed to unregister swap:', e);
    }
  });
}

/**
 * Attempt to recover all pending reverse swaps on app startup.
 * For each persisted swap:
 *  - Query Boltz API for current status
 *  - If transaction.mempool/confirmed, build and broadcast claim tx
 *  - If already claimed or expired, clean up
 */
export async function recoverPendingSwaps(): Promise<void> {
  // Wipe the attention set at the start of every pass so it always reflects
  // the current persisted swap state and not stale entries from prior runs.
  // Without this, payment hashes for swaps that have since been removed
  // (terminal cleanup, manual deletion, an empty index, etc.) would keep
  // badging rows. The pass below re-adds entries for swaps that genuinely
  // need attention, and the `finally` block fires a single `notifyAttention`
  // so subscribers see one coherent update per pass.
  attentionPaymentHashes.clear();
  try {
    const index = await SecureStore.getItemAsync(SWAP_INDEX_KEY);
    if (!index) return;
    const ids = JSON.parse(index) as string[];
    if (ids.length === 0) return;
    console.log(`[SwapRecovery] Checking ${ids.length} pending swap(s)`);
    Toast.show({
      type: 'info',
      text1: 'Checking pending swaps',
      text2: `${ids.length} swap${ids.length === 1 ? '' : 's'} to verify…`,
      position: 'top',
      visibilityTime: 8000,
    });

    for (const swapId of ids) {
      try {
        await recoverSwap(swapId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[SwapRecovery] Failed to recover swap ${swapId}:`, e);
        Toast.show({
          type: 'error',
          text1: 'Swap recovery failed',
          text2: msg,
          position: 'top',
          visibilityTime: 10000,
        });
      }
    }
  } catch (e) {
    console.warn('[SwapRecovery] Failed to load swap index:', e);
  } finally {
    // Single notify after the batch so subscribers (TransactionList) re-render
    // once per recovery pass instead of once per swap.
    notifyAttention();
  }
}

async function recoverSwap(swapId: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(`boltz_swap_${swapId}`);
  if (!raw) {
    // Stale index entry
    await unregisterPendingSwap(swapId);
    return;
  }

  const swap = JSON.parse(raw) as PersistedReverseSwap;
  const paymentHash = swap.preimage ? paymentHashFromPreimage(swap.preimage) : null;

  // Query Boltz status
  const res = await fetch(`${BOLTZ_API}/swap/${swapId}`);
  if (!res.ok) {
    console.warn(`[SwapRecovery] Boltz returned ${res.status} for ${swapId}`);
    if (res.status === 404) {
      await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
      await unregisterPendingSwap(swapId);
      if (paymentHash) attentionPaymentHashes.delete(paymentHash);
    }
    return;
  }
  const data = await res.json();
  console.log(`[SwapRecovery] Swap ${swapId} status: ${data.status}`);

  // Terminal success states — cleanup
  if (data.status === 'invoice.settled' || data.status === 'transaction.claimed') {
    console.log(`[SwapRecovery] Swap ${swapId} already complete, cleaning up`);
    await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
    await unregisterPendingSwap(swapId);
    if (paymentHash) attentionPaymentHashes.delete(paymentHash);
    // Remember the claim succeeded so TransactionList can badge the row
    // 'done'. We didn't perform the claim ourselves on this path, so the
    // txid isn't available — pass `null` and the detail-sheet Claim-tx
    // row simply won't render for this entry.
    if (paymentHash) recordClaimedPaymentHash(paymentHash, null);
    return;
  }

  // Failure states — cleanup
  if (
    data.status === 'swap.expired' ||
    data.status === 'transaction.refunded' ||
    data.status === 'transaction.failed' ||
    data.status === 'invoice.expired'
  ) {
    console.warn(`[SwapRecovery] Swap ${swapId} failed: ${data.status}`);
    await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
    await unregisterPendingSwap(swapId);
    if (paymentHash) attentionPaymentHashes.delete(paymentHash);
    return;
  }

  // Claimable — Boltz has locked funds on-chain, we need to claim
  if (data.status === 'transaction.mempool' || data.status === 'transaction.confirmed') {
    // If swapTree/refundPublicKey are missing (older persisted swaps),
    // Boltz doesn't expose them after swap creation. Unfortunately
    // recovery is impossible for those — note and move on.
    if (!swap.swapTree || !swap.refundPublicKey) {
      console.warn(
        `[SwapRecovery] Swap ${swapId} missing swapTree/refundPublicKey — cannot auto-claim. ` +
          `Funds will auto-refund to Boltz at timeout. Contact Boltz support with swap ID if needed.`,
      );
      if (paymentHash) attentionPaymentHashes.add(paymentHash);
      return;
    }

    const txId = data.transaction?.id;
    const txHex = data.transaction?.hex;
    if (!txId || !txHex) {
      console.warn(`[SwapRecovery] Swap ${swapId} missing lockup tx id/hex`);
      if (paymentHash) attentionPaymentHashes.add(paymentHash);
      return;
    }
    // v2 API doesn't include vout/onchainAmount in /swap/{id}. Derive them
    // from the raw lockup tx by matching our lockup address.
    const lockup = extractLockupFromTxHex(txHex, swap.lockupAddress);
    if (!lockup) {
      console.warn(
        `[SwapRecovery] Swap ${swapId} — could not find lockup output matching ${swap.lockupAddress}`,
      );
      if (paymentHash) attentionPaymentHashes.add(paymentHash);
      return;
    }
    const { vout, amount } = lockup;

    console.log(`[SwapRecovery] Claiming swap ${swapId}...`);
    const reverseSwap: boltzService.ReverseSwapResult = {
      id: swap.id,
      invoice: '',
      onchainAmount: amount,
      timeoutBlockHeight: 0,
      lockupAddress: swap.lockupAddress,
      refundPublicKey: swap.refundPublicKey,
      swapTree: swap.swapTree,
      preimage: swap.preimage,
      claimPrivateKey: swap.claimPrivateKey,
    };

    Toast.show({
      type: 'info',
      text1: 'Claiming swap',
      text2: `Broadcasting claim for ${amount.toLocaleString()} sats…`,
      position: 'top',
      visibilityTime: 8000,
    });
    let claimTxId: string;
    try {
      claimTxId = await boltzService.claimSwap(
        reverseSwap,
        { txId, vout, amount },
        swap.destinationAddress,
      );
    } catch (e) {
      // Claim broadcast / signing failed. Add to attention so the row badges
      // yellow and the detail sheet's "Retry claim" button gets the user's
      // attention; re-throw so recoverPendingSwaps' outer toast still fires.
      if (paymentHash) attentionPaymentHashes.add(paymentHash);
      throw e;
    }
    console.log(`[SwapRecovery] Swap ${swapId} claimed successfully (claim tx ${claimTxId})`);
    if (paymentHash) recordClaimedPaymentHash(paymentHash, claimTxId);
    Toast.show({
      type: 'success',
      text1: 'Swap recovered',
      text2: `${amount.toLocaleString()} sats claimed to your on-chain wallet`,
      position: 'top',
      visibilityTime: 10000,
    });

    await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
    await unregisterPendingSwap(swapId);
    if (paymentHash) attentionPaymentHashes.delete(paymentHash);
  }

  // Still pending (swap.created, invoice.set, etc.) — leave for next check
}
