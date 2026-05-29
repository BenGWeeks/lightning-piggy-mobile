// In-flight de-duplication for ExploreHomeScreen's by-author cache fetch.
//
// React 18 concurrent scheduling re-runs the triggering effect 2–3× in quick
// succession on mount (`userRelays` changes reference as relays hydrate). A
// plain "claimed keys" Set prevented the parallel fetches but had a stranding
// race (#752 Copilot): if the effect was cleaned up mid-flight, the replacement
// run saw the key still claimed and skipped, and when the old promise later
// resolved it discarded the data — so the user's own Piggies could stay missing
// until a pull-to-refresh changed the key.
//
// Instead we store the in-flight PROMISE per key. Concurrent callers JOIN it
// rather than starting a parallel request, and — crucially — the current
// (non-cancelled) effect run shares that same promise and performs the merge
// when it resolves, so cancellation never strands the data. The entry clears on
// settle, so a later mount or a failed fetch re-fetches.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Run `fetchFn` for `key` at most once concurrently. The first caller starts the
 * request; concurrent callers with the same key receive the same promise. The
 * entry is removed once the promise settles (success or failure), so subsequent
 * calls start a fresh request.
 */
export function joinExploreByAuthorFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fetchFn();
  inFlight.set(key, p);
  void Promise.resolve(p)
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
  return p;
}
