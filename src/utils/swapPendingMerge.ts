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
 * Supersession is exact when the placeholder carries a `swapId` (dropped the
 * moment its own real leg appears, #895) and otherwise by `type` — but only
 * when there's a *single* optimistic row of that type, so concurrent
 * same-direction swaps aren't all dropped by the first settled leg (#896).
 * Never fuzzy amount/time matching.
 */
export function preserveOptimisticSwapRows(
  fresh: readonly WalletTransaction[],
  existing: readonly WalletTransaction[],
  nowSeconds: number,
): WalletTransaction[] {
  // Only non-aged-out optimistic swap rows are candidates to keep.
  const optimistic = existing.filter(
    (t) => isOptimisticSwapRow(t) && nowSeconds - (t.created_at ?? 0) < SWAP_PENDING_MAX_AGE_S,
  );

  // Exact, per-swap supersession: fresh real legs tagged with the same swapId.
  const freshSwapIds = new Set(fresh.map((t) => t.swapId).filter((id): id is string => id != null));
  // Direction-level supersession: which types have a NEWLY-appeared swapId-tagged
  // leg this refresh. Keyed on "new" (swapId absent from `existing`) so a
  // *historical* same-type swap can't drop a brand-new placeholder whose own
  // real leg hasn't settled yet (Copilot review).
  const existingSwapIds = new Set(
    existing.map((t) => t.swapId).filter((id): id is string => id != null),
  );
  const newlySettledTypes = new Set(
    fresh.filter((t) => t.swapId != null && !existingSwapIds.has(t.swapId)).map((t) => t.type),
  );
  // …but only safe when we hold exactly one optimistic row of that type.
  const optimisticCountByType = new Map<WalletTransaction['type'], number>();
  for (const t of optimistic) {
    optimisticCountByType.set(t.type, (optimisticCountByType.get(t.type) ?? 0) + 1);
  }

  return optimistic.filter((t) => {
    // Prefer exact per-swap matching: drop the placeholder the moment its OWN
    // real leg appears, regardless of how many concurrent swaps are in flight.
    if (t.swapId != null) return !freshSwapIds.has(t.swapId);
    // Fall back to type matching only when this is the single optimistic row of
    // its type — with multiple concurrent same-direction swaps we can't tell
    // which the fresh leg belongs to, so keep them and let the 1h age-out clear
    // any straggler (#896).
    if (newlySettledTypes.has(t.type) && optimisticCountByType.get(t.type) === 1) return false;
    return true;
  });
}
