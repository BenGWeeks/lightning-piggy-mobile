/**
 * Which wallets' transaction lists Home keeps mounted (#1304). Mounting a list
 * is the expensive part of a wallet swipe (every visible row renders), so Home
 * keeps the active card's list plus its neighbours' lists mounted and only
 * toggles which one is visible. Bounded to at most three lists.
 */

/** The active wallet and its right and left neighbours, in carousel order of likelihood. */
export function warmWalletIds(walletIds: readonly string[], activeId: string | null): string[] {
  if (activeId === null) return [];
  const i = walletIds.indexOf(activeId);
  if (i < 0) return [];
  return [walletIds[i], walletIds[i + 1], walletIds[i - 1]].filter(
    (id): id is string => id !== undefined,
  );
}

/**
 * Lists to render this commit: the active one (always, so it shows at once)
 * plus any already-warm list that's still within the active card's warm set.
 * A list that was just active stays mounted when the user swipes to its
 * neighbour, so swiping back is instant too. Returned in carousel order.
 */
export function walletListsToRender(
  walletIds: readonly string[],
  activeId: string | null,
  warm: readonly string[],
): string[] {
  const allowed = new Set(warmWalletIds(walletIds, activeId));
  const keep = new Set(warm.filter((id) => allowed.has(id)));
  if (activeId !== null && allowed.has(activeId)) keep.add(activeId);
  return walletIds.filter((id) => keep.has(id));
}
