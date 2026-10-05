import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { fetchMarketListings, type MarketListingsResult } from '../services/marketListingsService';

export function useMarketListings(enabled: boolean) {
  const { pubkey, relays } = useNostr();
  const { contacts } = useNostrContacts();
  const focused = useIsFocused();
  const authorsKey = useMemo(
    () => [...new Set(contacts.map((contact) => contact.pubkey.toLowerCase()))].sort().join(','),
    [contacts],
  );
  const relaysKey = useMemo(
    () =>
      relays
        .filter((r) => r.read)
        .map((r) => r.url)
        .sort()
        .join(','),
    [relays],
  );
  const key = `${pubkey ?? ''}|${authorsKey}|${relaysKey}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<MarketListingsResult & { key: string; loading: boolean }>({
    key: '',
    products: [],
    incomplete: false,
    loading: false,
  });
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    if (!enabled || !focused || !pubkey) return;
    const controller = new AbortController();
    setState({ key, products: [], incomplete: false, loading: true });
    void fetchMarketListings(authorsKey.split(','), relaysKey.split(','), controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setState({ ...result, key, loading: false });
      },
    );
    return () => controller.abort();
  }, [enabled, focused, key, pubkey, authorsKey, relaysKey, revision]);
  return useMemo(
    () => ({
      products:
        state.key === key
          ? state.products.map((product) => {
              const contact = contacts.find(
                (c) => c.pubkey.toLowerCase() === product.listing?.event.pubkey,
              );
              const name =
                contact?.petname ||
                contact?.profile?.displayName ||
                contact?.profile?.name ||
                product.sellerName;
              if (!product.listing) return product;
              return {
                ...product,
                sellerName: name,
                listing: { ...product.listing, vendor: { ...product.listing.vendor, name } },
              };
            })
          : [],
      loading: enabled && !!pubkey && (state.key !== key || state.loading),
      incomplete: state.key === key && state.incomplete,
      refresh,
    }),
    [state, key, enabled, pubkey, refresh, contacts],
  );
}
