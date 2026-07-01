// Canonical "does this cache carry a withdrawable prize" predicate.
//
// A cache shows the yellow lightning prize indicator when it is a Lightning
// Piggy (`isLpPiggy`) AND advertises a payout (`payoutSats != null`). This is
// the exact gate LpPayoutBadge uses for the Geo-caches list, the Explore rail
// card and My Piglets — keeping the on-map bolt in lockstep with those lists.
//
// Kept as a standalone pure function (not a method on ParsedCache) so the map
// markers, the badge component and unit tests share ONE definition of "has a
// prize" rather than each re-checking the two fields inline.

/** The fields needed to decide prize presence — a structural subset of ParsedCache. */
export interface PrizeBearing {
  isLpPiggy: boolean;
  payoutSats: number | null | undefined;
}

/** True when the cache is an LP Piggy advertising a withdrawable payout. */
export const hasPrize = (cache: PrizeBearing): boolean =>
  cache.isLpPiggy && cache.payoutSats != null;
