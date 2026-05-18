import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNostr } from './NostrContext';
import {
  DEFAULT_SEED_PUBKEYS,
  computeTrustSet,
  isPubkeyTrusted,
} from '../services/trustGraphService';
// L2 (friends-of-friends) is currently disabled. The previous
// implementation eagerly fetched + cached the L2 set on every cold
// start, regardless of which WoT tier the user was on. For a graph of
// ~600 follows this produced a ~2 MB JSON blob in AsyncStorage —
// exactly at Android's SQLite CursorWindow ceiling — and a 20-30 s
// JS-thread freeze on read when the blob crossed the limit
// (SQLiteBlobTooBigException, see #565). The cost was paid by every
// user even though the default 'friends' tier doesn't use L2 at all.
//
// Next implementation should be foreground + explicit: when the user
// selects the FoF tier we open a progress dialog ("Downloading follow
// lists from N relays…"), stream the kind-3 fetches with a cancel
// button, and persist the result in a sharded form that can't exceed
// the CursorWindow limit (16 buckets keyed by first hex digit, each
// ~130 KB max). Tracked under GH #565.
//
// The fetcher module is intentionally not imported here while disabled,
// so any accidental call site fails at type-check.
// import { fetchL2Follows, loadL2Cache, persistL2Cache } from '../services/trustGraphFetcher';
import {
  loadWotSettings,
  saveWotSettings,
  type WotSettings,
  type WotTier,
} from '../services/wotSettingsService';

const L2_CACHE_KEY_PREFIX = '@lp:trust-graph-l2:';

// Re-export the tier type so consumers (chip + sheet) can type their props
// without reaching into the service layer.
export type { WotTier } from '../services/wotSettingsService';

interface TrustGraphContextType {
  // Lowercase-hex union of every pubkey that passes the *currently
  // persisted* tier. Consumers that care about UI-effective tier (e.g.
  // the parental-control hard-lock that clamps a persisted 'all' back
  // to 'friends' when secretMode is off) should call
  // `trustSetForTier(effectiveTier)` instead — otherwise a stale
  // persisted 'all' can leak past the gate (#547 follow-up).
  trustSet: ReadonlySet<string>;
  // Tier-aware membership predicate (#535).
  //   'friends' — kind-3 follow list + user + seeds
  //   'fof'     — friends + cached friends-of-follows
  //   'all'     — always returns true (filter disabled)
  // Uses the *persisted* tier — see `isTrustedAtTier` for the variant
  // that lets callers evaluate against a specific (e.g. effective) tier.
  isTrusted: (pubkey: string) => boolean;
  // Tier-parameterised version of `trustSet` — returns the set that
  // *would* apply if the requested tier were active, regardless of
  // what's persisted. Used by call sites that enforce against the
  // UI-effective tier (e.g. MessagesScreen) so the defensive trust
  // filter matches the hard-lock and a stale persisted 'all' can't
  // leak.
  trustSetForTier: (tier: WotTier) => ReadonlySet<string>;
  // Tier-parameterised membership predicate — same role as
  // `trustSetForTier` but for callers that prefer the predicate form
  // (e.g. GroupsContext's `visibleGroups` filter).
  isTrustedAtTier: (tier: WotTier, pubkey: string) => boolean;
  // Active tier (#535). Replaces the legacy `filterEnabled` boolean.
  wotTier: WotTier;
  // Persist + apply a new tier. Wider tiers (fof / all) are gated on
  // secretMode at the UI layer (WebOfTrustBottomSheet); this setter
  // doesn't enforce the gate so a power user with secretMode flipped
  // can still tier-switch without ceremony.
  setWotTier: (next: WotTier) => void;
  // L2 backfill state — `loading` until the friends-of-follows fetch
  // resolves; consumers can show a subtle "filter is still loading"
  // note while this is true.
  l2Loading: boolean;
  // Number of pubkeys in the L2 (friends-of-follows) set.
  l2Size: number;
  // Trigger an explicit L2 refresh (bypasses cache).
  refreshL2: () => Promise<void>;
}

const TrustGraphContext = createContext<TrustGraphContextType | null>(null);

interface ProviderProps {
  children: ReactNode;
}

export const TrustGraphProvider: React.FC<ProviderProps> = ({ children }) => {
  const { pubkey, contacts } = useNostr();

  // Direct follows (L1) — derived from NostrContext's contacts state.
  const l1Follows = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) s.add(c.pubkey.toLowerCase());
    return s;
  }, [contacts]);

  // L2 friends-of-follows is currently disabled (see top-of-file
  // comment + #565). Stays as an empty Set; consumers that consult
  // `l2Follows` (e.g. trustSet's tier branch) silently degrade FoF to
  // Friends-only. The setters are retained so we don't have to thread
  // conditional optionality through the rest of the file.
  const [l2Follows] = useState<Set<string>>(new Set());
  const l2Loading = false;

  const refreshL2 = useCallback(async () => {
    // No-op while L2 is disabled. Stubbed (rather than removed) so the
    // context's public shape stays stable for consumers like
    // WebOfTrustBottomSheet that already pull this through `useTrustGraph`.
  }, []);

  // One-time cleanup of the legacy L2 cache. The previous implementation
  // wrote a single ~2 MB blob keyed by `${L2_CACHE_KEY_PREFIX}${pubkey}`;
  // leaving it around (a) wastes storage for every existing install and
  // (b) keeps the SQLiteBlobTooBigException primed to fire if any code
  // path still tries to read it. Iterating getAllKeys is O(n) over total
  // AsyncStorage keys, which for this app is ~50, so the cost is trivial.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        if (cancelled) return;
        const stale = keys.filter((k) => k.startsWith(L2_CACHE_KEY_PREFIX));
        if (stale.length > 0) await AsyncStorage.multiRemove(stale);
      } catch {
        // Best-effort cleanup; failure is non-fatal and re-tries next launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persisted tier. Default 'all' (#627 — was 'friends' pre-#627 but
  // that left new users with an empty rail on the Geo-caches + Events
  // surfaces because they have no follows yet). DMs are independently
  // clamped via `GroupsContext.effectiveWotTier` so 'all' here is safe
  // for the Messages surface. Legacy boolean payloads are migrated
  // inside `loadWotSettings`.
  const [storedSettings, setStoredSettings] = useState<WotSettings>({ wotTier: 'all' });
  useEffect(() => {
    loadWotSettings().then(setStoredSettings);
  }, []);

  const wotTier = storedSettings.wotTier;

  const setWotTier = useCallback((next: WotTier) => {
    setStoredSettings({ wotTier: next });
    saveWotSettings({ wotTier: next }).catch(() => {});
  }, []);

  // For 'friends' tier the trust set is L1 + user + seeds.
  // For 'fof' tier it adds L2 (cached friends-of-follows).
  // For 'all' tier we still compute a trust set (so the UI can show
  // "n hidden" counts symmetrically) but `isTrusted` short-circuits to
  // true below.
  const trustSet = useMemo(() => {
    const effectiveL2 = wotTier === 'fof' || wotTier === 'all' ? l2Follows : new Set<string>();
    return computeTrustSet(pubkey, l1Follows, effectiveL2, true);
  }, [pubkey, l1Follows, l2Follows, wotTier]);

  // Tier-parameterised version of `trustSet`. Returns the set that
  // *would* apply if the requested tier were active, regardless of
  // what's persisted. Hot path: when the requested tier equals the
  // persisted one we hand back the memoised `trustSet` directly so
  // we don't rebuild on every consumer call.
  const trustSetForTier = useCallback(
    (tier: WotTier): ReadonlySet<string> => {
      if (tier === wotTier) return trustSet;
      const effectiveL2 = tier === 'fof' || tier === 'all' ? l2Follows : new Set<string>();
      return computeTrustSet(pubkey, l1Follows, effectiveL2, true);
    },
    [trustSet, wotTier, pubkey, l1Follows, l2Follows],
  );

  const isTrusted = useCallback(
    (pk: string) => {
      // 'all' tier disables the filter entirely. Consumers still call
      // `isTrusted` (so the call sites don't have to branch on tier);
      // we just return true unconditionally.
      if (wotTier === 'all') return true;
      return isPubkeyTrusted(pk, trustSet);
    },
    [trustSet, wotTier],
  );

  // Tier-parameterised membership predicate. Same `'all'`
  // short-circuit, but evaluates against the *requested* tier rather
  // than the persisted one — see `trustSetForTier` for the rationale.
  const isTrustedAtTier = useCallback(
    (tier: WotTier, pk: string) => {
      if (tier === 'all') return true;
      return isPubkeyTrusted(pk, trustSetForTier(tier));
    },
    [trustSetForTier],
  );

  const value = useMemo<TrustGraphContextType>(
    () => ({
      trustSet,
      isTrusted,
      trustSetForTier,
      isTrustedAtTier,
      wotTier,
      setWotTier,
      l2Loading,
      l2Size: l2Follows.size,
      refreshL2,
    }),
    [
      trustSet,
      isTrusted,
      trustSetForTier,
      isTrustedAtTier,
      wotTier,
      setWotTier,
      l2Loading,
      l2Follows,
      refreshL2,
    ],
  );

  return <TrustGraphContext.Provider value={value}>{children}</TrustGraphContext.Provider>;
};

export const useTrustGraph = (): TrustGraphContextType => {
  const ctx = useContext(TrustGraphContext);
  if (!ctx) throw new Error('useTrustGraph must be used inside <TrustGraphProvider>');
  return ctx;
};

// Re-export so consumers can reference the seed list (e.g. "follow these
// recommended accounts" UI) without depending on the service module.
export { DEFAULT_SEED_PUBKEYS };
