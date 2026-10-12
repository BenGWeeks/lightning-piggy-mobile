import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Toast } from '../components/BrandedToast';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { MARKET_PRODUCTS } from '../data/marketProducts';
import {
  fetchPreferredSellers,
  getPreferredSellers,
  PREFERRED_SELLERS_ACCOUNT,
} from '../services/marketPreferredSellers';
import { samplePreferredProducts } from '../utils/marketSample';
import { useMarketListings } from './useMarketListings';

export function usePreferredMarketListings(enabled = true) {
  const { relays } = useNostr();
  const t = useTranslation();
  const [authors, setAuthors] = useState<readonly string[] | undefined>(
    () => getPreferredSellers()?.authors,
  );
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const relaysKey = relays
    .filter((relay) => relay.read)
    .map((relay) => relay.url)
    .sort()
    .join(',');
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      // Explicit refresh also invalidates a fresh kind-3 cache.
      const controller = new AbortController();
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let dismissToast: (() => void) | undefined;
      const load = (retry = false) =>
        fetchPreferredSellers(
          relaysKey.split(','),
          controller.signal,
          (cached) => {
            if (!controller.signal.aborted) setAuthors(cached);
          },
          retry || revision > 0,
        )
          .then((next) => {
            if (!controller.signal.aborted) {
              setAuthors(next);
              setFailed(false);
            }
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setFailed(true);
            if (!retry) retryTimer = setTimeout(() => void load(true), 1500);
            else
              dismissToast = Toast.showOwned({
                type: 'info',
                text1: t('market.live.partialToast'),
                autoHide: true,
                visibilityTime: 3500,
              });
          });
      void load();
      return () => {
        controller.abort();
        if (retryTimer) clearTimeout(retryTimer);
        dismissToast?.();
      };
    }, [enabled, relaysKey, revision, t]),
  );
  const scope = useMemo(
    () => ({ account: PREFERRED_SELLERS_ACCOUNT, authors: authors ?? [] }),
    [authors],
  );
  const live = useMarketListings(enabled && authors !== undefined, scope);
  const refreshListings = live.refresh;
  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    refreshListings();
  }, [refreshListings]);
  return {
    ...live,
    refresh,
    incomplete: failed || live.incomplete,
    loading: enabled && !failed && (authors === undefined || live.loading),
    products: live.hasSnapshot ? live.products : MARKET_PRODUCTS,
  };
}

export function usePreferredMarketSample() {
  const { products } = usePreferredMarketListings();
  return useMemo(() => samplePreferredProducts(products), [products]);
}
