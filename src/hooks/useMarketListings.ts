import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Toast } from '../components/BrandedToast';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { fetchMarketListings, type MarketListingsResult } from '../services/marketListingsService';
import {
  getMarketSnapshot,
  unexpiredMarketProducts,
  readMarketSnapshot,
  writeMarketSnapshot,
} from '../services/marketStorage';

/**
 * A snapshot younger than this is reused when the user flips back to WoT:
 * Friends (or the screen refocuses) instead of re-querying every relay. The
 * Refresh button always fetches.
 */
export const MARKET_SNAPSHOT_FRESH_MS = 2 * 60 * 1000;

export function useMarketListings(
  enabled: boolean,
  scope?: { account: string; authors: readonly string[] },
) {
  const { pubkey, relays } = useNostr();
  const { contacts } = useNostrContacts();
  const t = useTranslation();
  const focused = useIsFocused();
  const authorsKey = useMemo(
    () =>
      [...new Set(scope?.authors ?? contacts.map((contact) => contact.pubkey.toLowerCase()))]
        .sort()
        .join(','),
    [contacts, scope?.authors],
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
  const account = scope?.account ?? pubkey;
  const key = `${account ?? ''}|${authorsKey}|${relaysKey}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<
    MarketListingsResult & { key: string; loading: boolean; completed: boolean }
  >(() => ({
    ...(getMarketSnapshot(key)?.result ?? { products: [], incomplete: false }),
    key,
    loading: false,
    completed: false,
  }));
  // The last complete snapshot, with its scope, landing time and the refresh
  // revision it answered — a ref, so recording it never re-runs the effect.
  const lastFetch = useRef<{
    key: string;
    at: number;
    revision: number;
    result: MarketListingsResult;
  } | null>(null);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !focused || !account) return;
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
          prev.key === key && !prev.loading
            ? prev
            : { ...cached, key, loading: false, completed: true },
        );
        return;
      }
      const controller = new AbortController();
      const cached = getMarketSnapshot(key);
      let received = false;
      if (!cached)
        void readMarketSnapshot(key).then((snapshot) => {
          if (!snapshot || received || controller.signal.aborted) return;
          setState({ ...snapshot.result, key, loading: true, completed: false });
        });
      // Refreshing the same account/follow scope keeps the current snapshot on
      // screen (and so the user's filters); only a new scope starts empty.
      setState((prev) =>
        prev.key === key
          ? { ...prev, loading: true }
          : {
              ...(cached?.result ?? { products: [], incomplete: false }),
              key,
              loading: true,
              completed: false,
            },
      );
      // Paint the newest verified listings early on a first load. A refresh
      // keeps showing its previous (longer) snapshot until the full result.
      const onFirstPage = (products: MarketListingsResult['products']) => {
        if (controller.signal.aborted) return;
        received = true;
        setState((prev) =>
          prev.key === key && prev.products.length >= products.length
            ? prev
            : { key, products, incomplete: false, loading: true, completed: false },
        );
      };
      let dismissToast: (() => void) | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      const load = () =>
        fetchMarketListings(
          authorsKey.split(','),
          relaysKey.split(','),
          controller.signal,
          onFirstPage,
        ).catch(
          (): MarketListingsResult => ({ products: [], incomplete: true, transportFailed: true }),
        );
      const showResult = (result: MarketListingsResult, loading: boolean, completed: boolean) =>
        setState((prev) => ({
          ...result,
          products:
            result.transportFailed && result.products.length === 0 && prev.key === key
              ? prev.products
              : result.products,
          key,
          loading,
          completed,
        }));
      const publish = (result: MarketListingsResult) => {
        if (controller.signal.aborted) return;
        received = true;
        showResult(result, false, true);
        if (!result.incomplete || result.products.length > 0) void writeMarketSnapshot(key, result);
        // Only a complete snapshot is worth reusing; a partial one refetches.
        lastFetch.current = result.incomplete ? null : { key, at: Date.now(), revision, result };
      };
      void load().then((result) => {
        if (controller.signal.aborted) return;
        if (!result.incomplete) {
          publish(result);
          return;
        }
        received = true;
        showResult(result, true, false);
        retryTimer = setTimeout(() => {
          void load().then((retried) => {
            if (controller.signal.aborted) return;
            publish(retried);
            if (retried.incomplete)
              dismissToast = Toast.showOwned({
                type: 'info',
                text1: t('market.live.partialToast'),
                autoHide: true,
                visibilityTime: 3500,
              });
          });
        }, 1500);
      });
      return () => {
        controller.abort();
        if (retryTimer) clearTimeout(retryTimer);
        dismissToast?.();
      };
    }, [enabled, focused, key, account, authorsKey, relaysKey, revision, t]),
  );
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
          ? unexpiredMarketProducts(state.products).map((product) => {
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
      loading: enabled && !!account && (state.key !== key || state.loading),
      completed: state.key === key && state.completed,
      hasSnapshot:
        state.key === key &&
        ((state.completed && !state.incomplete) ||
          state.products.length > 0 ||
          !!getMarketSnapshot(key)),
      incomplete: state.key === key && state.incomplete,
      refresh,
    }),
    [state, key, enabled, account, refresh, contactsByPubkey],
  );
}
