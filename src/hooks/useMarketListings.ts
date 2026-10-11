import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { fetchMarketListings, type MarketListingsResult } from '../services/marketListingsService';

/**
 * A snapshot younger than this is reused when the user flips back to WoT:
 * Friends (or the screen refocuses) instead of re-querying every relay. The
 * Refresh button always fetches.
 */
export const MARKET_SNAPSHOT_FRESH_MS = 2 * 60 * 1000;

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
  // The last complete snapshot, with its scope, landing time and the refresh
  // revision it answered — a ref, so recording it never re-runs the effect.
  const lastFetch = useRef<{
    key: string;
    at: number;
    revision: number;
    result: MarketListingsResult;
  } | null>(null);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    if (!enabled || !focused || !pubkey) return;
    const last = lastFetch.current;
    if (
      last &&
      last.key === key &&
      last.revision === revision &&
      Date.now() - last.at < MARKET_SNAPSHOT_FRESH_MS
    ) {
      // Show the cached snapshot. State may hold something else: a refetch
      // aborted mid-flight (mode switch / blur) leaves `loading` set, and a
      // brief detour through another scope leaves that scope's key.
      const cached = last.result;
      setState((prev) =>
        prev.key === key && !prev.loading ? prev : { ...cached, key, loading: false },
      );
      return;
    }
    const controller = new AbortController();
    // Refreshing the same account/follow scope keeps the current snapshot on
    // screen (and so the user's filters); only a new scope starts empty.
    setState((prev) =>
      prev.key === key
        ? { ...prev, loading: true }
        : { key, products: [], incomplete: false, loading: true },
    );
    // Paint the newest verified listings early on a first load. A refresh
    // keeps showing its previous (longer) snapshot until the full result.
    const onFirstPage = (products: MarketListingsResult['products']) => {
      if (controller.signal.aborted) return;
      setState((prev) =>
        prev.key === key && prev.products.length >= products.length
          ? prev
          : { key, products, incomplete: false, loading: true },
      );
    };
    void fetchMarketListings(
      authorsKey.split(','),
      relaysKey.split(','),
      controller.signal,
      onFirstPage,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setState({ ...result, key, loading: false });
      // Only a complete snapshot is worth reusing; a partial one refetches.
      lastFetch.current = result.incomplete ? null : { key, at: Date.now(), revision, result };
    });
    return () => controller.abort();
  }, [enabled, focused, key, pubkey, authorsKey, relaysKey, revision]);
  // O(1) seller lookup — a linear `contacts.find` per product was O(products ×
  // follows) on every profile trickle (250 × 650+ for a typical account).
  const contactsByPubkey = useMemo(
    () => new Map(contacts.map((c) => [c.pubkey.toLowerCase(), c])),
    [contacts],
  );
  return useMemo(
    () => ({
      products:
        state.key === key
          ? state.products.map((product) => {
              const contact = product.listing
                ? contactsByPubkey.get(product.listing.event.pubkey)
                : undefined;
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
    [state, key, enabled, pubkey, refresh, contactsByPubkey],
  );
}
