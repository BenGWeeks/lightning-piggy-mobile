import { useEffect, useState } from 'react';
import * as zapSenderProfileStorage from '../services/zapSenderProfileStorage';
import * as nostrService from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import type { NostrProfile } from '../types/nostr';

/**
 * Compact pubkey-to-profile lookup, used by anywhere we surface a hex
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
 * Components consuming the hook get a `{name, picture, lud16}` triple
 * (null when unknown / pending) — enough to render an avatar + name +
 * a Zap button when applicable.
 */
export interface PubkeyProfileSlice {
  name: string | null;
  picture: string | null;
  lud16: string | null;
  /** True while the relay fallback is in flight. */
  loading: boolean;
}

const empty: PubkeyProfileSlice = { name: null, picture: null, lud16: null, loading: false };

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
    setSlice((prev) => ({ ...prev, loading: true }));
    (async () => {
      // Cache hit — sync-fast, no relay round-trip.
      const cached = await zapSenderProfileStorage.get(pubkey);
      if (cancelled) return;
      if (cached) {
        setSlice({
          name: cached.displayName ?? cached.name ?? null,
          picture: cached.picture ?? null,
          // zapSenderProfileStorage's narrow shape doesn't carry lud16;
          // we'll pick it up on the relay fetch below if missing.
          lud16: null,
          loading: true,
        });
      }
      // Always also try the relay (cheap when already known, fills in
      // lud16 / refreshes a stale name). Use the user's configured read
      // relays; PROFILE_RELAYS is unioned in `fetchProfile`.
      const readRelays = readRelaysKey.split('|').filter(Boolean);
      const profile: NostrProfile | null = await nostrService
        .fetchProfile(pubkey, readRelays)
        .catch(() => null);
      if (cancelled) return;
      if (profile) {
        setSlice({
          name: profile.displayName ?? profile.name ?? null,
          picture: profile.picture ?? null,
          lud16: profile.lud16 ?? null,
          loading: false,
        });
        // Write back to the cache so other surfaces resolve instantly.
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
