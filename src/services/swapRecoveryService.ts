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
import Toast from 'react-native-toast-message';
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
