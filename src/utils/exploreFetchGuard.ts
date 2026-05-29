// One-shot guard for ExploreHomeScreen's by-author cache fetch. Module-scoped
// on purpose (NOT a component useRef): React 18 concurrent scheduling re-runs
// the triggering effect 2–3× in quick succession on mount — `userRelays`
// changes reference as relays hydrate — and the re-runs can fire before a ref
// write is observed, launching parallel `fetchCachesByAuthor` calls (3 to 5
// relays each). That was a real symptom in the #751 warm-path audit (three
// completions within 10 ms). Module state is synchronous and shared across
// those runs, so the first to claim a key wins and the rest skip.
//
// Keyed by `${pubkey}:${refreshKey}`, so pull-to-refresh (new refreshKey) and
// an account switch (new pubkey) still re-fetch — only the redundant parallel
// re-fires of the *same* key are suppressed.
const claimedKeys = new Set<string>();

/**
 * Claim a fetch key. Returns `true` the first time a key is seen (the caller
 * should proceed with the fetch) and `false` on every subsequent call for that
 * key (the caller should skip — a fetch for it already started).
 */
export function claimExploreByAuthorFetch(key: string): boolean {
  if (claimedKeys.has(key)) return false;
  claimedKeys.add(key);
  return true;
}
