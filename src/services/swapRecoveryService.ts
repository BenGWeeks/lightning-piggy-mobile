/**
 * Swap recovery service.
 *
 * On app startup, scans SecureStore for persisted Boltz swap state and
 * resumes any swaps that are claimable. This prevents loss of funds when
 * a reverse swap's pay_invoice timeout caused the app to abort before
 * reaching the claim step.
 */

import * as SecureStore from 'expo-secure-store';
import * as boltzService from './boltzService';

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

export async function registerPendingSwap(swapId: string): Promise<void> {
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
}

export async function unregisterPendingSwap(swapId: string): Promise<void> {
  try {
    const existing = await SecureStore.getItemAsync(SWAP_INDEX_KEY);
    if (!existing) return;
    const ids = (JSON.parse(existing) as string[]).filter((id) => id !== swapId);
    await SecureStore.setItemAsync(SWAP_INDEX_KEY, JSON.stringify(ids));
  } catch (e) {
    console.warn('[SwapRecovery] Failed to unregister swap:', e);
  }
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
    console.log(`[SwapRecovery] Checking ${ids.length} pending swap(s)`);

    for (const swapId of ids) {
      try {
        await recoverSwap(swapId);
      } catch (e) {
        console.warn(`[SwapRecovery] Failed to recover swap ${swapId}:`, e);
      }
    }
  } catch (e) {
    console.warn('[SwapRecovery] Failed to load swap index:', e);
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
    const vout = data.transaction?.index;
    const amount = data.onchainAmount;
    if (!txId || !Number.isInteger(vout) || !amount) {
      console.warn(`[SwapRecovery] Swap ${swapId} missing lockup details`);
      return;
    }

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

    await boltzService.claimSwap(reverseSwap, { txId, vout, amount }, swap.destinationAddress);
    console.log(`[SwapRecovery] Swap ${swapId} claimed successfully`);

    await SecureStore.deleteItemAsync(`boltz_swap_${swapId}`);
    await unregisterPendingSwap(swapId);
  }

  // Still pending (swap.created, invoice.set, etc.) — leave for next check
}
