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
import { loadWotSettings, saveWotSettings, type WotSettings } from '../services/wotSettingsService';

interface TrustGraphContextType {
  /**
   * Lowercase hex set of every pubkey the user trusts to surface
   * caches/events from. Always includes the user, L1 follows, L2
   * friends-of-follows, and the platform-curated seed pubkeys.
   */
  trustSet: ReadonlySet<string>;
  /** Predicate convenience — `isTrusted(pubkey)` returns true iff `pubkey`
   * (case-insensitive) is in `trustSet`. */
  isTrusted: (pubkey: string) => boolean;
  /**
   * Whether the filter is active. Caches/events from outside `trustSet`
   * should be hidden by consumers when this is true.
   *
   * **Production builds ignore the persisted setting and force this
   * to `true`** — the threat model (geo-cache as physical lure) makes
   * it too easy to footgun yourself if a regular user toggles it off.
   * Dev builds honour the toggle so we can test the unfiltered view.
   */
  filterEnabled: boolean;
  /** Update + persist the dev-mode toggle. No-op in production builds. */
  setFilterEnabled: (next: boolean) => void;
  /**
   * L2 backfill state — `loading` until the friends-of-follows fetch
   * resolves; consumers can show a subtle "filter is still loading"
   * note while this is true.
   */
  l2Loading: boolean;
  /** Number of pubkeys in the L2 (friends-of-follows) set. */
  l2Size: number;
  /** Trigger an explicit L2 refresh (bypasses cache). Useful from a
   * Settings → Refresh trust graph button. */
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

  // Persisted dev-mode toggle. In production builds we hard-code true.
  const [storedSettings, setStoredSettings] = useState<WotSettings>({ filterEnabled: true });
  useEffect(() => {
    loadWotSettings().then(setStoredSettings);
  }, []);

  const filterEnabled = __DEV__ ? storedSettings.filterEnabled : true;

  const setFilterEnabled = useCallback((next: boolean) => {
    if (!__DEV__) return; // Hard-locked ON outside dev builds.
    setStoredSettings({ filterEnabled: next });
    saveWotSettings({ filterEnabled: next }).catch(() => {});
  }, []);

  const trustSet = useMemo(
    () => computeTrustSet(pubkey, l1Follows, l2Follows, true),
    [pubkey, l1Follows, l2Follows],
  );
  const isTrusted = useCallback((pk: string) => isPubkeyTrusted(pk, trustSet), [trustSet]);

  const value = useMemo<TrustGraphContextType>(
    () => ({
      trustSet,
      isTrusted,
      filterEnabled,
      setFilterEnabled,
      l2Loading,
      l2Size: l2Follows.size,
      refreshL2,
    }),
    [trustSet, isTrusted, filterEnabled, setFilterEnabled, l2Loading, l2Follows, refreshL2],
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
