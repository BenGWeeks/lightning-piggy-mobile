import type { Scope, TranslateOptions } from 'i18n-js';
import Toast from '../components/BrandedToast';
import { markSwapPlaceholdersResolved } from './swapPendingMerge';

export const SWAP_COMPLETE_TOAST_MS = 10_000;
// Allow the toast's hide animation to finish before starting wallet work.
export const SWAP_REFRESH_DELAY_MS = SWAP_COMPLETE_TOAST_MS + 500;

/** Refresh is best-effort and outlives the sheet that initiated the swap. */
export function deferSwapRefresh(
  refresh: () => Promise<unknown>,
  isCurrent: () => boolean = () => true,
): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    void Promise.resolve()
      .then(() => {
        if (!cancelled && isCurrent()) return refresh();
      })
      .catch(() => {});
  }, SWAP_REFRESH_DELAY_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/** Claim completion must return without waiting for either wallet to sync. */
export function completeReverseSwap(options: {
  swapId: string;
  amount: string;
  txId: string;
  t: (scope: Scope, options?: TranslateOptions) => string;
  refresh: () => Promise<unknown>;
  followSettle: () => void;
  deferRefresh: (refresh: () => Promise<unknown>) => void;
}): void {
  Toast.show({
    type: 'success',
    text1: options.t('swapToast.completeTitle'),
    text2: options.t('swapToast.claimedBody', {
      amount: options.amount,
      txid: options.txId.slice(0, 10),
    }),
    position: 'top',
    visibilityTime: SWAP_COMPLETE_TOAST_MS,
  });
  markSwapPlaceholdersResolved(options.swapId);
  options.deferRefresh(options.refresh);
  options.followSettle();
}

/** Balance and history for only the wallets owned by the initiating profile. */
export function createSwapWalletRefresher(wallet: {
  refreshBalanceForWallet: (id: string) => Promise<unknown>;
  fetchTransactionsForWallet: (id: string) => Promise<unknown>;
}) {
  return (ids: string[]) =>
    Promise.all(
      ids.flatMap((id) => [
        wallet.refreshBalanceForWallet(id),
        wallet.fetchTransactionsForWallet(id),
      ]),
    );
}
