import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useLocales } from 'expo-localization';
import { useNostr } from '../contexts/NostrContext';
import { deviceCountryCode } from '../data/countries';
import type { MarketProduct } from '../data/marketProducts';
import { cachedShippingOption, resolveShippingOptions } from '../services/marketShippingCache';
import type { ShippingOption } from '../utils/marketShipping';
import {
  normalizeShipsToSelection,
  productShipsTo,
  shippingCoordinatesOf,
  type ShipsTo,
} from '../utils/marketShipsTo';

/** Listings stream in a first page then the rest; wait for them to settle so
 * one batched fetch covers both. */
const SETTLE_MS = 400;
const NO_ANSWERS: ReadonlyMap<string, ShippingOption | null> = new Map();

export interface MarketShipsTo {
  /** Ships-to per product id, for every product passed in. */
  byProduct: ReadonlyMap<string, ShipsTo>;
  /** The phone's region country (alpha-2), if it has one. */
  deviceCountry: string | null;
}

/**
 * Where each Market product ships to, from its seller's published kind-30406
 * options. Arms on focus only: the screen's listings' shipping coordinates are
 * resolved in batched, cached queries (services/marketShippingCache) and
 * committed in ONE state update per fetch — never per relay event or per card.
 */
export function useMarketShipsTo(
  products: readonly MarketProduct[],
  enabled: boolean,
): MarketShipsTo {
  const { relays } = useNostr();
  const readKey = relays
    .filter((r) => r.read)
    .map((r) => r.url)
    .join(',');
  const coordinateKey = useMemo(
    () => shippingCoordinatesOf(products).sort().join('\n'),
    [products],
  );
  const [answers, setAnswers] = useState(NO_ANSWERS);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !coordinateKey) return;
      // Revalidate retained answers on every focus. The shared cache owns
      // expiry and retries; local display state must never bypass it.
      const coordinates = coordinateKey.split('\n');
      const controller = new AbortController();
      // Merge a batch of answers — once per fetch, so one Map copy per batch.
      const commit = (batch: ReadonlyMap<string, ShippingOption | null>) => {
        if (controller.signal.aborted || batch.size === 0) return;
        setAnswers((current) => {
          const merged = new Map(current);
          for (const [coordinate, option] of batch) merged.set(coordinate, option);
          return merged;
        });
      };
      const timer = setTimeout(() => {
        resolveShippingOptions({
          coordinates,
          relays: readKey ? readKey.split(',') : [],
          signal: controller.signal,
        })
          .then(commit)
          // A failed relay set leaves these listings "shipping unknown" for
          // this visit (not cached), rather than loading forever; the next
          // focus retries.
          .catch(() =>
            commit(new Map(coordinates.map((c) => [c, cachedShippingOption(c) ?? null]))),
          );
      }, SETTLE_MS);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }, [enabled, coordinateKey, readKey]),
  );

  const byProduct = useMemo(() => {
    const lookup = (coordinate: string) => answers.get(coordinate);
    return new Map(products.map((p) => [p.id, productShipsTo(p, lookup)]));
  }, [products, answers]);

  // The OS region setting (expo-localization), else the locale's region subtag.
  const locales = useLocales();
  const deviceCountry = useMemo(
    () => normalizeShipsToSelection(locales[0]?.regionCode) ?? deviceCountryCode(),
    [locales],
  );

  return useMemo(() => ({ byProduct, deviceCountry }), [byProduct, deviceCountry]);
}
