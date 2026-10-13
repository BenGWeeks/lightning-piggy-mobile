import type { WalletState, WalletTransaction } from '../types/wallet';

/** Attribution may finish after history refresh. Merge into its authoritative
 * row without overwriting fees, settlement state or timestamps with estimates.
 * Direction matters: a self-payment has two legs sharing the same hash. */
export function upsertPendingWalletTransaction(
  wallets: WalletState[],
  walletId: string,
  pending: WalletTransaction,
): WalletState[] {
  const paymentHash = pending.paymentHash?.toLowerCase();
  return wallets.map((wallet) => {
    if (wallet.id !== walletId) return wallet;
    const index = paymentHash
      ? wallet.transactions.findIndex(
          (tx) => tx.type === pending.type && tx.paymentHash?.toLowerCase() === paymentHash,
        )
      : -1;
    const transactions =
      index < 0
        ? [pending, ...wallet.transactions]
        : wallet.transactions.map((tx, i) =>
            i === index
              ? { ...tx, zapCounterparty: pending.zapCounterparty ?? tx.zapCounterparty }
              : tx,
          );
    return { ...wallet, transactions };
  });
}
