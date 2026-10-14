import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getBtcPrice } from '../services/fiatService';

// BTC spot prices for Market listing currencies other than the user's own
// (whose rate the wallet already polls). One module-level store shared by
// every price on screen: a grid of EUR listings triggers ONE fetch, not one
// per card, and every card reads the same entry. Reuses `getBtcPrice`
// (CoinGecko, 5-minute cache) — no new price API.

const FRESH_MS = 5 * 60 * 1000;
// A failed lookup isn't retried on every mount — at most once a minute.
const RETRY_MS = 60 * 1000;

const prices = new Map<string, { price: number | null; at: number }>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function ensureFresh(currency: string): void {
  const entry = prices.get(currency);
  const age = entry ? Date.now() - entry.at : Infinity;
  if (inflight.has(currency) || age < (entry?.price ? FRESH_MS : RETRY_MS)) return;
  inflight.add(currency);
  getBtcPrice(currency)
    .catch(() => null)
    .then((price) => {
      // Keep the last good price over a failed refresh.
      const previous = prices.get(currency)?.price ?? null;
      prices.set(currency, { price: price ?? previous, at: Date.now() });
      inflight.delete(currency);
      listeners.forEach((notify) => notify());
    });
}

const noopUnsubscribe = () => {};

/**
 * BTC spot price in `currency`, or null until it loads. Pass null when no
 * separate rate is needed — the hook then neither fetches nor subscribes.
 */
export function useListingBtcPrice(currency: string | null): number | null {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!currency) return noopUnsubscribe;
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    [currency],
  );
  const getSnapshot = () => (currency ? (prices.get(currency)?.price ?? null) : null);
  const price = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (currency) ensureFresh(currency);
  }, [currency]);
  return price;
}

/** Test-only: forget every cached rate. */
export function __resetListingBtcPricesForTests(): void {
  prices.clear();
  inflight.clear();
}
