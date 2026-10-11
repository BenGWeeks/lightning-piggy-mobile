import type { Event as NostrEvent } from 'nostr-tools/pure';
import { nostrGetEventHash, nostrVerifyEvent } from './nostrCrypto';

// Verified-event-id cache (#605 follow-up). The 2026-05-17 CDP profile
// of the Explore tab freeze showed 25-30 % of the 16 s tab-switch is
// Schnorr verification on the Hermes JS thread (`mul` / `sqrtMod` /
// `pow2` / `Maj`). The relay's filter-EOSE replay on every re-subscribe
// re-emits the same events we already verified on the previous focus,
// and each one pays the full ~25 ms cost again. Caching the id of
// every successfully-verified event lets re-subscribes skip the
// secp256k1 work.
//
// Only ids that passed the FULL schnorr check are cached, and a cache hit
// still re-hashes the event (~µs) to confirm the id matches the content.
// Without that, a relay could replay a known id on a forged payload, or an
// id that only passed a structural check would be trusted as signed.
//
// Bounded at 10 000 entries with O(1) circular-buffer eviction so a
// long-running session doesn't drift to unlimited memory. 10 000
// event-ids at 64 bytes each ≈ 640 KB — negligible. The cache is
// module-scoped so it survives across screen focus / blur / tab
// switches. (Eviction was once `Array.prototype.shift()` — O(n) per call
// once full; PR #628 Copilot review.)
const VERIFIED_CACHE_CAP = 10_000;
const verifiedEventIds = new Set<string>();
const verifiedEventOrder = new Array<string | null>(VERIFIED_CACHE_CAP).fill(null);
let verifiedHead = 0;

function rememberVerified(id: string): void {
  if (verifiedEventIds.has(id)) return;
  // Evict the slot we're about to overwrite (null on first cap-1 calls,
  // then the oldest live id once the buffer wraps). Set.delete on null
  // is a no-op so we don't need a separate branch for the cold path.
  const evicted = verifiedEventOrder[verifiedHead];
  if (evicted !== null) verifiedEventIds.delete(evicted);
  verifiedEventOrder[verifiedHead] = id;
  verifiedEventIds.add(id);
  verifiedHead = (verifiedHead + 1) % VERIFIED_CACHE_CAP;
}

/** Full signature check, skipping the schnorr for ids that already passed it. */
export function verifyEventCached(event: NostrEvent): boolean {
  if (typeof event.id !== 'string') return false;
  try {
    if (verifiedEventIds.has(event.id)) return nostrGetEventHash(event) === event.id;
    const ok = nostrVerifyEvent(event);
    if (ok) rememberVerified(event.id);
    return ok;
  } catch {
    return false;
  }
}

// Exposed for tests and for the rare case a downstream code path
// explicitly wants to invalidate (e.g. trust-graph change that
// requires re-checking authorship).
export const __resetVerifiedEventCache = (): void => {
  verifiedEventIds.clear();
  verifiedEventOrder.fill(null);
  verifiedHead = 0;
};
export const __verifiedEventCacheSize = (): number => verifiedEventIds.size;
