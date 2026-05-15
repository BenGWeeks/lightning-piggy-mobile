import { useEffect, useState } from 'react';
import * as zapSenderProfileStorage from '../services/zapSenderProfileStorage';
import * as nostrService from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import type { NostrProfile } from '../types/nostr';

/**
 * Compact pubkey-to-profile lookup, used anywhere we surface a hex
 * pubkey we'd like to render as "{display_name} {avatar}". Cache
 * priority:
 *
 *   1. `zapSenderProfileStorage` — in-memory + AsyncStorage cache that
 *      already exists for transaction-list zap counterparties. 24-hour
 *      TTL, ~50 ms reads after first hydrate.
 *   2. Fallthrough to `nostrService.fetchProfile(pubkey, readRelays)`
 *      — relay round-trip, typically a few hundred ms. Result is
 *      written back to the cache so subsequent renders are fast.
 *
 * Components get a `{name, picture, lud16}` triple (null when
 * unknown / pending) — enough to render an avatar + name + a Zap
 * button when applicable.
 *
 * Performance notes (see #554):
 *   - **Skip-on-complete-hit**: when the cache has every field the
 *     hook returns (including lud16), we return early without hitting
 *     a relay. Previously the hook always fired a relay round-trip
 *     even on a cache hit, because lud16 wasn't persisted — that gave
 *     us ~1 relay query per visible avatar across every contact row,
 *     log entry, and hider chip. Cumulative cost grew quietly with the
 *     Explore tab's new profile-render surfaces.
 *   - **In-flight de-dup**: a module-level `inFlight` Map collapses
 *     concurrent fetches for the same pubkey into one. Without it,
 *     two screens rendering the same friend (e.g. Friends + an open
 *     Conversation) fanned out independent WebSocket queries.
 */
export interface PubkeyProfileSlice {
  name: string | null;
  picture: string | null;
  lud16: string | null;
  /** True while the relay fallback is in flight. */
  loading: boolean;
}

const empty: PubkeyProfileSlice = { name: null, picture: null, lud16: null, loading: false };

// In-flight de-duplication: concurrent consumers asking for the same
// pubkey share one fetch. Cleared when the promise settles so a later
// remount triggers a fresh fetch if the cache has aged past TTL.
const inFlight = new Map<string, Promise<NostrProfile | null>>();

function fetchProfileDeduped(
  pubkey: string,
  readRelays: string[],
): Promise<NostrProfile | null> {
  const existing = inFlight.get(pubkey);
  if (existing) return existing;
  const promise = nostrService
    .fetchProfile(pubkey, readRelays)
    .catch(() => null)
    .finally(() => {
      // Clear only if this is still the in-flight promise — concurrent
      // identity-equality check, no risk of clobbering a newer fetch
      // started while this one was settling.
      if (inFlight.get(pubkey) === promise) inFlight.delete(pubkey);
    });
  inFlight.set(pubkey, promise);
  return promise;
}

export const usePubkeyProfile = (pubkey: string | null | undefined): PubkeyProfileSlice => {
  const { relays } = useNostr();
  // Stable serialised key — NostrContext re-emits a fresh `relays`
  // array reference on every kind-10002 update, which would otherwise
  // re-fire the fetchProfile effect across every mounted screen.
  // Per Copilot review on PR #488.
  const readRelaysKey = relays
    .filter((r) => r.read)
    .map((r) => r.url)
    .sort()
    .join('|');
  const [slice, setSlice] = useState<PubkeyProfileSlice>(empty);

  useEffect(() => {
    if (!pubkey) {
      setSlice(empty);
      return;
    }
    let cancelled = false;
    (async () => {
      // Cache hit — sync-fast, no relay round-trip.
      const cached = await zapSenderProfileStorage.get(pubkey);
      if (cancelled) return;
      // Complete-hit short-circuit: if the cache carries lud16 (even
      // explicitly null) we have everything the hook returns. The TTL
      // filter on `zapSenderProfileStorage.get` already returns null
      // for entries older than 24 h, so "cache hit" implies "still
      // fresh". This is the path that closes the fan-out for the
      // common case (#554).
      if (cached && cached.lud16 !== undefined) {
        setSlice({
          name: cached.displayName ?? cached.name ?? null,
          picture: cached.picture ?? null,
          lud16: cached.lud16,
          loading: false,
        });
        return;
      }
      // Either no cache entry or a legacy entry without lud16. Show
      // what we have while we fetch the missing fields.
      if (cached) {
        setSlice({
          name: cached.displayName ?? cached.name ?? null,
          picture: cached.picture ?? null,
          lud16: null,
          loading: true,
        });
      } else {
        setSlice((prev) => ({ ...prev, loading: true }));
      }
      const readRelays = readRelaysKey.split('|').filter(Boolean);
      const profile = await fetchProfileDeduped(pubkey, readRelays);
      if (cancelled) return;
      if (profile) {
        setSlice({
          name: profile.displayName ?? profile.name ?? null,
          picture: profile.picture ?? null,
          lud16: profile.lud16 ?? null,
          loading: false,
        });
        // Write back to the cache, now WITH lud16, so future mounts
        // get the complete-hit short-circuit above.
        zapSenderProfileStorage
          .setMany(
            new Map([
              [
                pubkey,
                {
                  npub: profile.npub,
                  name: profile.name,
                  displayName: profile.displayName,
                  picture: profile.picture,
                  nip05: profile.nip05,
                  lud16: profile.lud16 ?? null,
                },
              ],
            ]),
          )
          .catch(() => {});
      } else {
        setSlice((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pubkey, readRelaysKey]);

  return slice;
};

// Test hook: clear the in-flight map between tests so cross-test state
// can't leak. Not exported as part of the public API.
export const __resetInFlightForTests = (): void => {
  inFlight.clear();
};
