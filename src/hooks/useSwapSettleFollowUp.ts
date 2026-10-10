import { useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { followUpSwapSettlement, isSwapLegDone } from '../services/swapSettleFollowUp';

/**
 * Returns `follow(walletId, paymentHash)`: after a Boltz reverse swap
 * completes, keep refreshing the paying wallet's history + balance (bounded)
 * until the wallet reports the swap's Lightning leg settled (#1179) — see
 * `swapSettleFollowUp` for why the wallet can lag the swap by minutes.
 */
export function useSwapSettleFollowUp() {
  const { wallets, refreshBalanceForWallet, fetchTransactionsForWallet } = useWallet();
  // Synced during render so each follow-up tick reads the latest wallet list.
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  return useCallback(
    (walletId: string, paymentHash: string | null | undefined) => {
      if (!paymentHash) return;
      followUpSwapSettlement({
        key: `${walletId}:${paymentHash}`,
        refresh: async () => {
          await fetchTransactionsForWallet(walletId);
          await refreshBalanceForWallet(walletId);
        },
        isDone: () => isSwapLegDone(walletsRef.current, walletId, paymentHash),
      });
    },
    [fetchTransactionsForWallet, refreshBalanceForWallet],
  );
}
