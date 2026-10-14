import { useCallback, useSyncExternalStore } from 'react';
import { getBtcPrice } from '../services/fiatService';

// BTC spot prices for Market listing currencies other than the user's own
// (whose rate the wallet already polls). One module-level store shared by
// every price on screen: a grid of EUR listings triggers ONE fetch, not one
// per card, and every card reads the same entry. Reuses `getBtcPrice`
// (CoinGecko, 5-minute cache) — no new price API.

const FRESH_MS = 5 * 60 * 1000;
// A failed lookup isn't retried on every mount — at most once a minute.
const RETRY_MS = 60 * 1000;

const prices = new Map<string, { price: number | null; nextFetchAt: number }>();
const inflight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRefresh(currency: string): void {
  if (!listeners.has(currency) || timers.has(currency) || inflight.has(currency)) return;
  const delay = Math.max(0, (prices.get(currency)?.nextFetchAt ?? 0) - Date.now());
  timers.set(
    currency,
    setTimeout(() => {
      timers.delete(currency);
      ensureFresh(currency);
    }, delay),
  );
}

function ensureFresh(currency: string): void {
  const entry = prices.get(currency);
  if (inflight.has(currency)) return;
  if (entry && Date.now() < entry.nextFetchAt) {
    scheduleRefresh(currency);
    return;
  }
  inflight.add(currency);
  // Let this store preserve the displayed fallback so a failed refresh still
  // retries after a minute instead of treating a service fallback as fresh.
  getBtcPrice(currency, { allowStale: false })
    .catch(() => null)
    .then((price) => {
      // Keep the last good price over a failed refresh.
      const previous = prices.get(currency)?.price ?? null;
      prices.set(currency, {
        price: price ?? previous,
        nextFetchAt: Date.now() + (price === null ? RETRY_MS : FRESH_MS),
      });
      inflight.delete(currency);
      listeners.get(currency)?.forEach((notify) => notify());
      scheduleRefresh(currency);
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
      const subscribers = listeners.get(currency) ?? new Set<() => void>();
      subscribers.add(notify);
      listeners.set(currency, subscribers);
      ensureFresh(currency);
      return () => {
        subscribers.delete(notify);
        if (subscribers.size === 0) {
          listeners.delete(currency);
          clearTimeout(timers.get(currency));
          timers.delete(currency);
        }
      };
    },
    [currency],
  );
  const getSnapshot = () => (currency ? (prices.get(currency)?.price ?? null) : null);
  const price = useSyncExternalStore(subscribe, getSnapshot);
  return price;
}

/** Test-only: forget every cached rate. */
export function __resetListingBtcPricesForTests(): void {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  prices.clear();
  inflight.clear();
}
