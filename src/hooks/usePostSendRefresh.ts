import { useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { deferPostPaymentRefresh } from '../utils/deferPostPaymentRefresh';
import { useSwapSettleFollowUp } from './useSwapSettleFollowUp';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SendSheet's post-send refresh: the balance now; the transaction list just
 * after the success overlay's interaction frame; and, for a Boltz reverse
 * swap, follow-ups until the wallet settles the swap's Lightning leg (#1179).
 */
export function usePostSendRefresh() {
  const { refreshBalanceForWallet, fetchTransactionsForWallet } = useWallet();
  const followSwapSettle = useSwapSettleFollowUp();
  return useCallback(
    async (walletId: string, swapPaymentHash?: string | null) => {
      await refreshBalanceForWallet(walletId);
      // Defer the heavy tx-list refresh (JSON.stringify + zap resolver) off
      // the interaction path so the success overlay's OK tap is serviced
      // immediately rather than blocked behind it (#859, #828). LNbits records
      // an outgoing payment asynchronously after pay_invoice returns, so an
      // immediate list can miss it — fetch after a beat, then once more in
      // case that raced too. The second fetch re-runs the zap-sender resolver
      // over the counterparty entry the send just wrote.
      deferPostPaymentRefresh(async () => {
        try {
          await sleep(600);
          await fetchTransactionsForWallet(walletId);
          await sleep(1500);
          await fetchTransactionsForWallet(walletId);
        } catch {
          // Non-fatal: pull-to-refresh or the next natural refresh catches up.
        }
      });
      followSwapSettle(walletId, swapPaymentHash);
    },
    [refreshBalanceForWallet, fetchTransactionsForWallet, followSwapSettle],
  );
}
