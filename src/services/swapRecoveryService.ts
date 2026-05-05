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
import Toast from '../components/BrandedToast';
import * as boltzService from './boltzService';

// Required for bitcoinjs-lib to derive output scripts from taproot (bech32m)
// addresses — lockup addresses are taproot, so without this toOutputScript
// throws "No ECC Library provided".
bitcoin.initEccLib(ecc);

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
const SUBMARINE_INDEX_KEY = 'boltz_submarine_swap_index';

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
 * Submarine-swap (on-chain → LN) registry.
 *
 * Kept in a separate index from reverse swaps because their recovery flow
 * is different: reverse swaps need an automatic claim-tx broadcast (we
 * have all the keys), submarine swaps need a refund-tx broadcast that
 * needs a fresh user-controlled destination address — we can't
 * auto-broadcast without that, so recovery surfaces a toast + lets the
 * caller drive the actual refund.
 */
export async function registerPendingSubmarineSwap(swapId: string): Promise<void> {
  return withIndexLock(async () => {
    try {
      const existing = await SecureStore.getItemAsync(SUBMARINE_INDEX_KEY);
      const ids = existing ? (JSON.parse(existing) as string[]) : [];
      if (!ids.includes(swapId)) {
        ids.push(swapId);
        await SecureStore.setItemAsync(SUBMARINE_INDEX_KEY, JSON.stringify(ids));
      }
    } catch (e) {
      console.warn('[SwapRecovery] Failed to register submarine swap:', e);
    }
  });
}

export async function unregisterPendingSubmarineSwap(swapId: string): Promise<void> {
  return withIndexLock(async () => {
    try {
      const existing = await SecureStore.getItemAsync(SUBMARINE_INDEX_KEY);
      if (!existing) return;
      const ids = (JSON.parse(existing) as string[]).filter((id) => id !== swapId);
      await SecureStore.setItemAsync(SUBMARINE_INDEX_KEY, JSON.stringify(ids));
    } catch (e) {
      console.warn('[SwapRecovery] Failed to unregister submarine swap:', e);
    }
  });
}

interface PersistedSubmarineSwap {
  id: string;
  address: string;
  expectedAmount: number;
  refundPrivateKey: string;
  claimPublicKey: string;
  timeoutBlockHeight: number;
  swapTree: {
    claimLeaf: { version: number; output: string };
    refundLeaf: { version: number; output: string };
  };
  /** Optional: if the originator persisted a fallback refund destination
   *  (e.g. fresh address from one of the user's on-chain wallets), the
   *  recovery flow can auto-broadcast the refund without prompting. */
  refundDestinationAddress?: string;
  createdAt?: number;
}

/**
 * Attempt to recover all pending reverse swaps on app startup.
 * For each persisted swap:
 *  - Query Boltz API for current status
 *  - If transaction.mempool/confirmed, build and broadcast claim tx
 *  - If already claimed or expired, clean up
 */
export async function recoverPendingSwaps(): Promise<void> {
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
  }

  // Submarine swaps (on-chain → LN, issue #92). Separate index because
  // recovery semantics differ — see registerPendingSubmarineSwap docs.
  try {
    const submarineIndex = await SecureStore.getItemAsync(SUBMARINE_INDEX_KEY);
    if (!submarineIndex) return;
    const ids = JSON.parse(submarineIndex) as string[];
    if (ids.length === 0) return;
    console.log(`[SwapRecovery] Checking ${ids.length} pending submarine swap(s)`);

    for (const swapId of ids) {
      try {
        await recoverSubmarineSwap(swapId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[SwapRecovery] Failed to recover submarine swap ${swapId}:`, e);
        Toast.show({
          type: 'error',
          text1: 'Submarine swap recovery failed',
          text2: msg,
          position: 'top',
          visibilityTime: 10000,
        });
      }
    }
  } catch (e) {
    console.warn('[SwapRecovery] Failed to load submarine swap index:', e);
  }
}

/**
 * Walk a single submarine swap's status. Three terminal outcomes:
 *  1. Boltz paid the LN invoice → cleanup, refresh balance via toast.
 *  2. Swap failed and lockup tx exists → surface a Toast prompting the
 *     user to open the Receive sheet's recovery flow (we don't auto-
 *     broadcast — refund needs a fresh destination address the user
 *     should approve).
 *  3. Swap failed with no lockup → cleanup (Boltz never received funds).
 *
 * Pending status (still awaiting on-chain payment / mempool / claim) →
 * leave the entry in place for the next launch.
 */
async function recoverSubmarineSwap(swapId: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(`submarine_swap_${swapId}`);
  if (!raw) {
    await unregisterPendingSubmarineSwap(swapId);
    return;
  }

  const swap = JSON.parse(raw) as PersistedSubmarineSwap;

  const res = await fetch(`${BOLTZ_API}/swap/${swapId}`);
  if (!res.ok) {
    console.warn(`[SwapRecovery] Boltz returned ${res.status} for submarine ${swapId}`);
    if (res.status === 404) {
      await SecureStore.deleteItemAsync(`submarine_swap_${swapId}`);
      await unregisterPendingSubmarineSwap(swapId);
    }
    return;
  }
  const data = await res.json();
  console.log(`[SwapRecovery] Submarine swap ${swapId} status: ${data.status}`);

  // Success
  if (
    data.status === 'invoice.settled' ||
    data.status === 'transaction.claimed' ||
    data.status === 'invoice.paid'
  ) {
    console.log(`[SwapRecovery] Submarine swap ${swapId} already complete, cleaning up`);
    Toast.show({
      type: 'success',
      text1: 'Boltz swap complete',
      text2: `${swap.expectedAmount.toLocaleString()} sats arrived in your Lightning wallet`,
      position: 'top',
      visibilityTime: 8000,
    });
    await SecureStore.deleteItemAsync(`submarine_swap_${swapId}`);
    await unregisterPendingSubmarineSwap(swapId);
    return;
  }

  // Failure — check for refundable lockup
  const FAIL_STATUSES = [
    'swap.expired',
    'transaction.refunded',
    'invoice.failedToPay',
    'transaction.lockupFailed',
    'transaction.failed',
  ];
  if (FAIL_STATUSES.includes(data.status)) {
    if (data.status === 'transaction.refunded') {
      // Boltz already refunded (cooperative path) — nothing for us to do.
      console.log(`[SwapRecovery] Submarine swap ${swapId} already refunded by Boltz`);
      await SecureStore.deleteItemAsync(`submarine_swap_${swapId}`);
      await unregisterPendingSubmarineSwap(swapId);
      return;
    }
    const lockup = await boltzService.getSubmarineSwapLockup(swapId);
    if (!lockup) {
      // No on-chain payment ever landed — safe to drop.
      console.log(`[SwapRecovery] Submarine swap ${swapId} failed before lockup, cleaning up`);
      await SecureStore.deleteItemAsync(`submarine_swap_${swapId}`);
      await unregisterPendingSubmarineSwap(swapId);
      return;
    }

    // Refundable. If the originator stored a destination address, broadcast
    // a refund automatically — this is the safest behaviour because the
    // refund window is bounded by `timeoutBlockHeight` and a missed refund
    // can mean permanent loss. If no destination was stored, surface a
    // Toast and leave the entry; the user must trigger the refund manually
    // from the Receive flow.
    if (swap.refundDestinationAddress) {
      try {
        const submarineSwap: boltzService.SubmarineSwapResult = {
          id: swap.id,
          address: swap.address,
          expectedAmount: swap.expectedAmount,
          refundPrivateKey: swap.refundPrivateKey,
          claimPublicKey: swap.claimPublicKey,
          timeoutBlockHeight: swap.timeoutBlockHeight,
          swapTree: swap.swapTree,
        };
        Toast.show({
          type: 'info',
          text1: 'Refunding Boltz swap',
          text2: `Broadcasting refund for ${lockup.amount.toLocaleString()} sats…`,
          position: 'top',
          visibilityTime: 8000,
        });
        const refundTxId = await boltzService.refundSwap(
          submarineSwap,
          lockup,
          swap.refundDestinationAddress,
        );
        Toast.show({
          type: 'success',
          text1: 'Refund broadcast',
          text2: `${lockup.amount.toLocaleString()} sats refunded (${refundTxId.slice(0, 10)}…)`,
          position: 'top',
          visibilityTime: 10000,
        });
        await SecureStore.deleteItemAsync(`submarine_swap_${swapId}`);
        await unregisterPendingSubmarineSwap(swapId);
      } catch (refundErr) {
        const msg = refundErr instanceof Error ? refundErr.message : String(refundErr);
        console.warn(`[SwapRecovery] Auto-refund of ${swapId} failed:`, msg);
        Toast.show({
          type: 'error',
          text1: 'Boltz refund failed — manual action needed',
          text2: msg,
          position: 'top',
          visibilityTime: 12000,
        });
      }
    } else {
      Toast.show({
        type: 'error',
        text1: 'Boltz swap failed — refund available',
        text2: `${lockup.amount.toLocaleString()} sats locked. Open Receive → Boltz to refund.`,
        position: 'top',
        visibilityTime: 12000,
      });
    }
    return;
  }

  // Still pending — leave for next check.
}

async function recoverSwap(swapId: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(`boltz_swap_${swapId}`);
  if (!raw) {
    // Stale index entry
    await unregisterPendingSwap(swapId);
    return;
  }

  const swap = JSON.parse(raw) as PersistedReverseSwap;

  // Query Boltz status
  const res = await fetch(`${BOLTZ_API}/swap/${swapId}`);
  if (!res.ok) {
    console.warn(`[SwapRecovery] Boltz returned ${res.status} for ${swapId}`);
    if (res.status === 404) {
      await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
      await unregisterPendingSwap(swapId);
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
      return;
    }

    const txId = data.transaction?.id;
    const txHex = data.transaction?.hex;
    if (!txId || !txHex) {
      console.warn(`[SwapRecovery] Swap ${swapId} missing lockup tx id/hex`);
      return;
    }
    // v2 API doesn't include vout/onchainAmount in /swap/{id}. Derive them
    // from the raw lockup tx by matching our lockup address.
    const lockup = extractLockupFromTxHex(txHex, swap.lockupAddress);
    if (!lockup) {
      console.warn(
        `[SwapRecovery] Swap ${swapId} — could not find lockup output matching ${swap.lockupAddress}`,
      );
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
    await boltzService.claimSwap(reverseSwap, { txId, vout, amount }, swap.destinationAddress);
    console.log(`[SwapRecovery] Swap ${swapId} claimed successfully`);
    Toast.show({
      type: 'success',
      text1: 'Swap recovered',
      text2: `${amount.toLocaleString()} sats claimed to your on-chain wallet`,
      position: 'top',
      visibilityTime: 10000,
    });

    await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
    await unregisterPendingSwap(swapId);
  }

  // Still pending (swap.created, invoice.set, etc.) — leave for next check
}
