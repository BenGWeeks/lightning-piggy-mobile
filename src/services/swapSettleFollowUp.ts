import { isTransactionSettled } from '../utils/transactionSettlement';
import type { WalletTransaction } from '../types/wallet';

/**
 * Follow-up refreshes after a Boltz reverse swap completes while the paying
 * wallet still reports its Lightning leg as pending (#1179).
 *
 * Boltz's invoice is a hold invoice. The wallet's pay call can give up before
 * Boltz settles it, and the wallet then holds the payment — with a routing-fee
 * reserve on top — as "pending" until its own background check resolves it.
 * LNbits took ~8 min and held 640 sats in the 2026-10-10 run. The app's
 * balance refresh is event-driven (focus / foreground), so without this the
 * reserve-reduced balance stayed on screen indefinitely.
 *
 * Bounded by design (CLAUDE.md → "Relay filters are always bounded"): at most
 * `SWAP_SETTLE_REFRESH_DELAYS_MS.length` refreshes over ~22 minutes, stopping
 * as soon as the leg settles. One follow-up per wallet+payment: a repeat call
 * replaces the earlier one rather than stacking pollers.
 */
export const SWAP_SETTLE_REFRESH_DELAYS_MS: readonly number[] = [
  15_000, 30_000, 60_000, 120_000, 120_000, 180_000, 180_000, 300_000, 300_000,
];

export interface SwapSettleFollowUp {
  /** Identity of the follow-up; a second call with the same key replaces the first. */
  key: string;
  /** Refetch the wallet's transactions, THEN its balance — so the balance read
   *  always postdates the settle it is following. */
  refresh: () => Promise<void>;
  /** True once there's nothing left to wait for. */
  isDone: () => boolean;
  delaysMs?: readonly number[];
}

const active = new Map<string, () => void>();

/**
 * Schedule the follow-up refreshes; returns a cancel function. Deliberately
 * not tied to the screen that started it — the leg can settle long after the
 * Send / Move sheet closed. If `isDone` stops seeing fresh wallet state, the
 * schedule still ends on its own.
 */
export function followUpSwapSettlement(followUp: SwapSettleFollowUp): () => void {
  active.get(followUp.key)?.();
  const delays = followUp.delaysMs ?? SWAP_SETTLE_REFRESH_DELAYS_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    clearTimeout(timer);
    if (active.get(followUp.key) === cancel) active.delete(followUp.key);
  };
  const schedule = (index: number) => {
    if (index >= delays.length) return cancel();
    timer = setTimeout(async () => {
      try {
        await followUp.refresh();
      } catch {
        // Non-fatal: the next tick (or the next organic refresh) retries.
      }
      if (cancelled) return;
      if (followUp.isDone()) cancel();
      else schedule(index + 1);
    }, delays[index]);
  };
  active.set(followUp.key, cancel);
  schedule(0);
  return cancel;
}

/**
 * Done when the wallet itself now reports the swap's Lightning leg settled —
 * a local payment proof alone isn't enough, since the wallet can keep the
 * payment (and its fee reserve) pending after replying — or the wallet is
 * gone (removed, or the user switched profile), leaving nothing to refresh.
 */
export function isSwapLegDone(
  wallets: readonly { id: string; transactions?: readonly WalletTransaction[] }[],
  walletId: string,
  paymentHash: string,
): boolean {
  const wallet = wallets.find((w) => w.id === walletId);
  if (!wallet) return true;
  const leg = wallet.transactions?.find(
    (tx) => tx.type === 'outgoing' && tx.paymentHash === paymentHash && !tx.optimistic,
  );
  return !!leg && isTransactionSettled(leg) && !leg.walletPending;
}
