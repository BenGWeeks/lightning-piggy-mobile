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
// Module-scoped, bounded LRU: replaying an inbox keeps its verified ids hot
// even when unrelated feeds insert thousands of newer events. Set insertion
// order gives O(1) refresh/eviction without shifting a large array.
const VERIFIED_CACHE_CAP = 10_000;
const verifiedEventIds = new Set<string>();

function rememberVerified(id: string): void {
  verifiedEventIds.delete(id);
  verifiedEventIds.add(id);
  if (verifiedEventIds.size > VERIFIED_CACHE_CAP) {
    verifiedEventIds.delete(verifiedEventIds.values().next().value!);
  }
}

/** Full signature check, skipping the schnorr for ids that already passed it. */
export function verifyEventCached(event: NostrEvent): boolean {
  if (typeof event.id !== 'string') return false;
  try {
    if (verifiedEventIds.has(event.id)) {
      if (nostrGetEventHash(event) !== event.id) return false;
      rememberVerified(event.id);
      return true;
    }
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
};
export const __verifiedEventCacheSize = (): number => verifiedEventIds.size;
