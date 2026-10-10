import * as SecureStore from 'expo-secure-store';
import Toast from '../components/BrandedToast';
import * as boltzService from '../services/boltzService';
import { markSwapPlaceholdersResolved } from './swapPendingMerge';
import {
  SUBMARINE_AWAITING_CONFIRMATION_MESSAGE,
  SUBMARINE_PAYING_MESSAGE,
  submarineSwapCompleteMessage,
} from './swapHandoff';

/**
 * How long the Move sheet's background task watches a forward swap.
 *
 * Boltz pays the invoice only after our on-chain lockup has 1 confirmation
 * (zero-conf is off). Blocks arrive as a Poisson process with a 10-minute
 * mean, so the old 15-minute watch ran out on ~22% of perfectly normal swaps
 * (e^-1.5) — the 2026-10-10 run took 12.5 min. An hour leaves ~0.25% (e^-6),
 * and even then the swap is only "still waiting", never failed (#1179).
 */
export const FORWARD_SWAP_WATCH_TIMEOUT_MS = 60 * 60_000;

/** The Move sheet's status line for a forward swap's Boltz status, or null to
 *  leave the current line alone. */
export function forwardSwapStatusMessage(status: string): string | null {
  switch (status) {
    case 'transaction.mempool':
      return SUBMARINE_AWAITING_CONFIRMATION_MESSAGE;
    case 'transaction.confirmed':
    case 'invoice.pending':
      return SUBMARINE_PAYING_MESSAGE;
    default:
      return null;
  }
}

/** The non-terminal "not finished yet" toast. Before the lockup confirms it is
 *  just block time, so it must not read as a problem. */
export function forwardSwapStillWaitingToast(lastStatus: string | null): {
  text1: string;
  text2: string;
} {
  const confirmed = lastStatus === 'transaction.confirmed' || lastStatus === 'invoice.pending';
  return confirmed
    ? {
        text1: 'Swap still settling',
        text2: 'Funds are safe — Boltz is finishing the Lightning payment.',
      }
    : {
        text1: 'Still waiting for a confirmation',
        text2:
          'Bitcoin blocks average ~10 min but sometimes take much longer. Funds are safe — the swap finishes automatically.',
      };
}

export interface ForwardSwapWatch {
  swapId: string;
  /** The Lightning invoice amount Boltz pays (not the lockup amount). */
  invoiceSats: number;
  /** Paint the Move sheet's status line; the caller ignores it once the
   *  sheet has moved on to another transfer. */
  onMessage: (message: string) => void;
  /** Refresh the wallets the swap touched. */
  refreshWallets: () => Promise<unknown>;
  /** An explicit Boltz failure: the invoice will never be paid → refund. */
  onFailed: (message: string) => Promise<void>;
}

/**
 * Watch a broadcast forward swap (on-chain → Lightning) until Boltz pays the
 * invoice, narrating the confirmation wait on the Move sheet. Never throws.
 */
export async function watchForwardSwap(watch: ForwardSwapWatch): Promise<void> {
  const { swapId, invoiceSats } = watch;
  let lastStatus: string | null = null;
  try {
    await boltzService.waitForSubmarineSwapComplete(
      swapId,
      FORWARD_SWAP_WATCH_TIMEOUT_MS,
      (status) => {
        lastStatus = status;
        const message = forwardSwapStatusMessage(status);
        if (message) watch.onMessage(message);
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    console.warn('[Transfer] Background submarine swap failed:', msg);
    // #894: ONLY an explicit Boltz FAIL_STATUS is terminal → refund path.
    // Timeouts AND transient/network errors (e.g. "Boltz status check
    // failed: 500", fetch failures) are ambiguous — the swap may still
    // settle — so show "still waiting", never a false "Swap Failed".
    if (boltzService.isExplicitSwapFailure(error)) {
      // Terminal: the Lightning leg will never arrive, so its placeholder
      // goes on the next refresh (the lockup is a real leg).
      markSwapPlaceholdersResolved(swapId);
      await watch.onFailed(msg);
    } else {
      Toast.show({
        type: 'info',
        ...forwardSwapStillWaitingToast(lastStatus),
        position: 'top',
        visibilityTime: 12000,
      });
    }
    return;
  }
  watch.onMessage(submarineSwapCompleteMessage(invoiceSats));
  Toast.show({
    type: 'success',
    text1: 'Swap complete',
    text2: `${invoiceSats.toLocaleString()} sats delivered via Lightning.`,
    position: 'top',
    visibilityTime: 10000,
  });
  markSwapPlaceholdersResolved(swapId);
  try {
    await SecureStore.deleteItemAsync(`submarine_swap_${swapId}`);
    await watch.refreshWallets();
  } catch {
    // Non-fatal: recovery retires the record; the next refresh catches up.
  }
}
