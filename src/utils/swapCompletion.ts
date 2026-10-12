import type { Scope, TranslateOptions } from 'i18n-js';
import Toast from '../components/BrandedToast';
import { markSwapPlaceholdersResolved } from './swapPendingMerge';

export const SWAP_COMPLETE_TOAST_MS = 10_000;
// Allow the toast's hide animation to finish before starting wallet work.
export const SWAP_REFRESH_DELAY_MS = SWAP_COMPLETE_TOAST_MS + 500;

/** Refresh is best-effort and outlives the sheet that initiated the swap. */
export function deferSwapRefresh(refresh: () => Promise<unknown>): void {
  setTimeout(() => {
    void Promise.resolve()
      .then(refresh)
      .catch(() => {});
  }, SWAP_REFRESH_DELAY_MS);
}

/** Claim completion must return without waiting for either wallet to sync. */
export function completeReverseSwap(options: {
  swapId: string;
  amount: string;
  txId: string;
  t: (scope: Scope, options?: TranslateOptions) => string;
  refresh: () => Promise<unknown>;
  followSettle: () => void;
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
  deferSwapRefresh(options.refresh);
  options.followSettle();
}
