import { useCallback, useEffect, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import {
  DEFAULT_MARKET_PREFERENCES,
  readMarketPreferences,
  writeMarketPreferences,
  type MarketPreferences,
} from '../services/marketStorage';

/** Hydration gates the first query and hides defaults during account changes. */
export function useMarketPreferences() {
  const { pubkey } = useNostr();
  const [state, setState] = useState({
    account: '',
    ready: false,
    value: DEFAULT_MARKET_PREFERENCES,
  });
  useEffect(() => {
    let cancelled = false;
    if (!pubkey) return;
    void readMarketPreferences(pubkey).then((value) => {
      if (!cancelled) setState({ account: pubkey, ready: true, value });
    });
    return () => {
      cancelled = true;
    };
  }, [pubkey]);
  const ready = !!pubkey && state.account === pubkey && state.ready;
  const update = useCallback(
    (patch: Partial<MarketPreferences>) => {
      if (!ready || !pubkey) return;
      setState((previous) => ({ ...previous, value: { ...previous.value, ...patch } }));
    },
    [ready, pubkey],
  );
  useEffect(() => {
    if (ready && pubkey) void writeMarketPreferences(pubkey, state.value);
  }, [ready, pubkey, state.value]);
  return { ready, preferences: ready ? state.value : DEFAULT_MARKET_PREFERENCES, update };
}
