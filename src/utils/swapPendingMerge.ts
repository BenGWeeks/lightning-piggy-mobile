import type { WalletTransaction } from '../types/wallet';

// Safety cap: if a swap fails/abandons and its real leg never appears, don't
// let the optimistic placeholder linger forever — age it out after an hour.
const SWAP_PENDING_MAX_AGE_S = 60 * 60;

function isOptimisticSwapRow(t: WalletTransaction): boolean {
  return (
    t.optimistic === true &&
    !t.settled_at &&
    (t.swapType != null || /boltz swap/i.test(t.description ?? ''))
  );
}

/**
 * Return the optimistic Boltz-swap pending rows from `existing` that should
 * survive a transaction-list refresh (#896).
 *
 * A swap leg is shown optimistically ("Boltz swap in progress") before its
 * real on-chain / Lightning tx settles. A plain list-replace on pull-to-
 * refresh would wipe that row even though the swap is still running. We keep
 * such a row until the real swap leg of the same direction shows up in the
 * fresh list (tagged with `swapId` by #895), or it ages out.
 *
 * Supersession is by `type` + the presence of a swapId-tagged fresh tx — never
 * fuzzy amount/time matching — so the placeholder is dropped the moment the
 * real leg appears (avoiding a duplicate row).
 */
export function preserveOptimisticSwapRows(
  fresh: readonly WalletTransaction[],
  existing: readonly WalletTransaction[],
  nowSeconds: number,
): WalletTransaction[] {
  const supersededTypes = new Set(fresh.filter((t) => t.swapId).map((t) => t.type));
  return existing.filter(
    (t) =>
      isOptimisticSwapRow(t) &&
      !supersededTypes.has(t.type) &&
      nowSeconds - (t.created_at ?? 0) < SWAP_PENDING_MAX_AGE_S,
  );
}
