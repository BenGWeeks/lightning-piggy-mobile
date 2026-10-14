import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { fetchLikedListings } from '../services/marketLikesService';
import type { MarketProduct } from '../data/marketProducts';

interface State {
  products: MarketProduct[];
  loading: boolean;
  failed: boolean;
}

/**
 * The viewer's liked Market listings (#1541), fetched on screen focus and on
 * pull-to-refresh — one bounded fetch, no live subscription. Listings that
 * are gone (deleted, sold, expired) are left out by the service.
 */
export function useLikedListings() {
  const { pubkey, relays } = useNostr();
  const readRelays = useMemo(() => {
    const r = relays.filter((x) => x.read).map((x) => x.url);
    return r.length > 0 ? r : DEFAULT_RELAYS;
  }, [relays]);
  const [state, setState] = useState<State>({ products: [], loading: false, failed: false });
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    controllerRef.current?.abort();
    if (!pubkey) {
      setState({ products: [], loading: false, failed: false });
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, failed: false }));
    fetchLikedListings(pubkey, readRelays, controller.signal).then(
      (products) => {
        if (!controller.signal.aborted) setState({ products, loading: false, failed: false });
      },
      () => {
        if (!controller.signal.aborted)
          setState((prev) => ({ ...prev, loading: false, failed: true }));
      },
    );
  }, [pubkey, readRelays]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => controllerRef.current?.abort();
    }, [load]),
  );
  return { ...state, signedIn: !!pubkey, refresh: load };
}
