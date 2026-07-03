/**
 * Backpressure cap for the in-memory NIP-17 wrap-id dedup set (#804).
 *
 * `knownWrapIds` (in `nostrLiveDmSub`) mirrors the persisted wrap cache so the
 * live sub can skip already-seen wraps without a disk read. Without a bound it
 * grows for the whole session — a busy account re-streams + accumulates
 * thousands of ids (MBs of RAM). A `Set` preserves insertion order, so evicting
 * from the front drops the oldest-seen wraps. Dedup is an optimization, not
 * correctness: an evicted-then-reseen wrap is just re-decrypted once and
 * re-caught by the persisted cache downstream, so eviction is safe (mirrors the
 * existing `seen` Set cap in the same file).
 *
 * Pure + dependency-free so it's unit-testable without the live-sub machinery.
 */
export const KNOWN_WRAP_IDS_CAP = 8000;

export function capKnownWrapIds(set: Set<string>): void {
  if (set.size <= KNOWN_WRAP_IDS_CAP) return;
  const target = Math.floor(KNOWN_WRAP_IDS_CAP * 0.75);
  const it = set.values();
  while (set.size > target) {
    const next = it.next();
    if (next.done) break;
    set.delete(next.value);
  }
}
