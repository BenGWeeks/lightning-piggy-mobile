import type { WalletTransaction } from '../types/wallet';
import type { OnchainTransaction } from '../services/onchainService';
import { getSwapMeta } from '../services/swapRecoveryService';
import { preserveOptimisticSwapRows } from './swapPendingMerge';

/**
 * Map on-chain (BDK) transactions to WalletTransactions.
 *
 * Any leg whose txid the app recorded as belonging to a Boltz swap (the
 * reverse-swap claim it broadcast, or the submarine lockup it sent) is
 * tagged with swapId/swapType and given a "Boltz swap" description, so the
 * transaction list badges it as a swap instead of a generic Sent/Received
 * (#895). EXACT txid match — never fuzzy.
 */
export function mapOnchainTransactions(
  raw: readonly OnchainTransaction[],
  existing: readonly WalletTransaction[] = [],
): WalletTransaction[] {
  const mapped = raw.map((tx) => {
    const meta = getSwapMeta(tx.txid);
    const description = meta
      ? meta.swapType === 'reverse'
        ? 'Boltz swap — received on-chain'
        : 'Boltz swap — sent on-chain'
      : tx.confirmed
        ? tx.type === 'incoming'
          ? 'Received'
          : 'Sent'
        : 'Pending';
    return {
      type: tx.type,
      amount: tx.amount,
      description,
      settled_at: tx.timestamp,
      created_at: tx.timestamp,
      blockHeight: tx.blockHeight,
      txid: tx.txid,
      swapId: meta?.swapId,
      swapType: meta?.swapType,
    };
  });
  // #896: keep optimistic Boltz-swap placeholder rows across a refresh until
  // the real on-chain leg appears (on-chain sync returns a full list that
  // would otherwise wipe them).
  const swapPending = preserveOptimisticSwapRows(mapped, existing, Math.floor(Date.now() / 1000));
  if (swapPending.length === 0) return mapped;
  return [...swapPending, ...mapped].sort(
    (a, b) => (b.settled_at ?? b.created_at ?? 0) - (a.settled_at ?? a.created_at ?? 0),
  );
}
