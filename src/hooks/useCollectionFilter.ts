import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { useNostr } from '../contexts/NostrContext';
import { fetchMarketCollections } from '../services/marketCollectionsService';
import {
  collectionCoordinate,
  productsInCollection,
  visibleCollections,
} from '../utils/marketCollectionFilters';
export function useCollectionFilter(products: MarketProduct[], enabled: boolean) {
  const { relays } = useNostr();
  const relayKey = relays
    .filter((r) => r.read)
    .map((r) => r.url)
    .join(',');
  const key = useMemo(() => products.map((p) => p.listing?.event.id ?? p.id).join(','), [products]);
  const [state, setState] = useState<{ key: string; events: Event[]; incomplete: boolean }>({
    key: '',
    events: [],
    incomplete: false,
  });
  const [selection, setSelection] = useState<{ key: string; coordinate: string | null }>({
    key: '',
    coordinate: null,
  });
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !products.some((p) => p.listing)) return;
      const controller = new AbortController();
      void fetchMarketCollections(products, relayKey.split(','), controller.signal)
        .then(({ events, incomplete }) => {
          if (!controller.signal.aborted)
            setState({ key, events: visibleCollections(events), incomplete });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState((previous) => ({
              key,
              events: previous.key === key ? previous.events : [],
              incomplete: true,
            }));
        });
      return () => controller.abort();
    }, [enabled, key, relayKey, products]),
  );
  const collections = state.key === key ? state.events : [];
  const selected = selection.key === key ? selection.coordinate : null;
  const collection = collections.find((e) => collectionCoordinate(e) === selected) ?? null;
  const filtered = useMemo(
    () => productsInCollection(products, collection),
    [products, collection],
  );
  const select = useCallback(
    (coordinate: string | null) => setSelection({ key, coordinate }),
    [key],
  );
  return {
    products: filtered,
    collections,
    selected: collection ? selected : null,
    select,
    incomplete: state.key === key && state.incomplete,
  };
}
