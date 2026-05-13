import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNostr } from './NostrContext';
import {
  DEFAULT_SEED_PUBKEYS,
  computeTrustSet,
  isPubkeyTrusted,
} from '../services/trustGraphService';
import { fetchL2Follows, loadL2Cache, persistL2Cache } from '../services/trustGraphFetcher';
import {
  loadWotSettings,
  saveWotSettings,
  type WotSettings,
  type WotTier,
} from '../services/wotSettingsService';

// Re-export the tier type so consumers (chip + sheet) can type their props
// without reaching into the service layer.
export type { WotTier } from '../services/wotSettingsService';

interface TrustGraphContextType {
  // Lowercase-hex union of every pubkey that passes the *currently selected*
  // tier. Consumers should keep using `isTrusted(pubkey)` rather than reading
  // `trustSet` directly so tier transitions don't require call-site changes.
  trustSet: ReadonlySet<string>;
  // Tier-aware membership predicate (#535).
  //   'friends' — kind-3 follow list + user + seeds
  //   'fof'     — friends + cached friends-of-follows
  //   'all'     — always returns true (filter disabled)
  isTrusted: (pubkey: string) => boolean;
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

  // L2 friends-of-follows. Cached in AsyncStorage; refreshed when the
  // L1 set changes or the 7-day TTL lapses.
  const [l2Follows, setL2Follows] = useState<Set<string>>(new Set());
  const [l2Loading, setL2Loading] = useState<boolean>(false);

  const refreshL2 = useCallback(async () => {
    if (!pubkey) return;
    setL2Loading(true);
    try {
      const fresh = await fetchL2Follows(l1Follows);
      setL2Follows(fresh);
      await persistL2Cache(pubkey, l1Follows, fresh);
    } finally {
      setL2Loading(false);
    }
  }, [pubkey, l1Follows]);

  // On L1 / pubkey change: try the cache first (cheap), then refresh
  // in the background if the cache is cold / stale / keyed differently.
  useEffect(() => {
    if (!pubkey) {
      setL2Follows(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await loadL2Cache(pubkey, l1Follows);
      if (cancelled) return;
      if (cached) {
        setL2Follows(cached);
        return;
      }
      // No usable cache — go to relays. Don't await here so the UI
      // doesn't block on the network round-trip; consumers see the
      // L1-only filter (more aggressive, safer) until L2 lands.
      setL2Loading(true);
      try {
        const fresh = await fetchL2Follows(l1Follows);
        if (cancelled) return;
        setL2Follows(fresh);
        await persistL2Cache(pubkey, l1Follows, fresh);
      } finally {
        if (!cancelled) setL2Loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pubkey, l1Follows]);

  // Persisted tier. Default 'friends' (#535). Legacy boolean payloads
  // are migrated inside `loadWotSettings`.
  const [storedSettings, setStoredSettings] = useState<WotSettings>({ wotTier: 'friends' });
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

  const value = useMemo<TrustGraphContextType>(
    () => ({
      trustSet,
      isTrusted,
      wotTier,
      setWotTier,
      l2Loading,
      l2Size: l2Follows.size,
      refreshL2,
    }),
    [trustSet, isTrusted, wotTier, setWotTier, l2Loading, l2Follows, refreshL2],
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
