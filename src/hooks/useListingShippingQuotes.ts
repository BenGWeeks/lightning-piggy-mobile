import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { fetchShippingOptionsForDisplay } from '../services/marketShippingService';
import {
  listingShippingRefs,
  quoteListingShipping,
  type ListingShippingQuote,
} from '../utils/marketListingShipping';
import type { ShippingOption } from '../utils/marketShipping';

export interface UseListingShippingQuotes {
  status: 'none' | 'loading' | 'ready' | 'error';
  quotes: ListingShippingQuote[];
  retry: () => void;
}

/**
 * Shipping quotes for a relay listing: fetch the seller's kind-30406 options
 * once per focus (only when the listing references any) and price each
 * referenced option with its per-item extra cost.
 */
export function useListingShippingQuotes(
  event: Event | undefined,
  currency: string,
): UseListingShippingQuotes {
  const { relays } = useNostr();
  const refs = useMemo(() => (event ? listingShippingRefs(event) : []), [event]);
  const [state, setState] = useState<{
    status: UseListingShippingQuotes['status'];
    options: ShippingOption[];
  }>({ status: 'none', options: [] });
  const [attempt, setAttempt] = useState(0);
  // One quiet retry before showing an error (first connections can all fail
  // right after launch or a network blip).
  const autoRetried = useRef(false);
  const merchant = event?.pubkey ?? null;
  const readKey = relays
    .filter((r) => r.read)
    .map((r) => r.url)
    .join(',');

  useFocusEffect(
    useCallback(() => {
      if (!merchant || refs.length === 0) {
        setState({ status: 'none', options: [] });
        return;
      }
      const controller = new AbortController();
      let cancelled = false;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      setState((prev) => ({ ...prev, status: 'loading' }));
      fetchShippingOptionsForDisplay({
        merchantPubkey: merchant,
        relays: readKey ? readKey.split(',') : [],
        signal: controller.signal,
      })
        .then((options) => {
          if (cancelled) return;
          autoRetried.current = false;
          setState({ status: 'ready', options });
        })
        .catch(() => {
          if (cancelled) return;
          if (!autoRetried.current) {
            autoRetried.current = true;
            retryTimer = setTimeout(() => setAttempt((a) => a + 1), 1500);
            return;
          }
          setState({ status: 'error', options: [] });
        });
      return () => {
        if (retryTimer) clearTimeout(retryTimer);
        cancelled = true;
        controller.abort();
      };
    }, [merchant, refs.length, readKey, attempt]),
  );

  const quotes = useMemo(
    () => quoteListingShipping(currency, refs, state.options),
    [currency, refs, state.options],
  );
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { status: state.status, quotes, retry };
}
