import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { fetchShippingOptions } from '../services/marketShippingService';
import type { ShippingOption } from '../utils/marketShipping';

// Checkout-side state for a merchant's kind-30406 shipping options (#948
// Option A). Fetches once per (open, merchant) and distinguishes three
// outcomes the sheet renders differently:
//   loading  → spinner row
//   ready    → country-first shipping selection (or no shipping section at
//              all when the merchant publishes zero options)
//   error    → retry row (relay unreachable ≠ "ships nowhere")

export interface UseShippingOptionsResult {
  status: 'idle' | 'loading' | 'ready' | 'error';
  options: ShippingOption[];
  /** Bump to refetch after an error. */
  retry: () => void;
}

export function useShippingOptions(
  merchantPubkey: string | null,
  enabled: boolean,
): UseShippingOptionsResult {
  const { relays } = useNostr();
  const [status, setStatus] = useState<UseShippingOptionsResult['status']>('idle');
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [attempt, setAttempt] = useState(0);

  // Focus-armed like the product feedback hooks: under the Explore stack's
  // freezeOnBlur a blurred checkout must abort its in-flight fetch rather than
  // commit state off-screen until the timeout.
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !merchantPubkey) {
        setStatus('idle');
        setOptions([]);
        return;
      }
      const controller = new AbortController();
      let cancelled = false;
      setStatus('loading');
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      fetchShippingOptions({ merchantPubkey, relays: readRelays, signal: controller.signal })
        .then((fetched) => {
          if (cancelled) return;
          setOptions(fetched);
          setStatus('ready');
        })
        .catch(() => {
          if (cancelled) return;
          setOptions([]);
          setStatus('error');
        });
      return () => {
        cancelled = true;
        controller.abort();
      };
      // `relays` is deliberately not a dependency: it can identity-change on
      // unrelated context updates mid-checkout, and re-fetching then would reset
      // the buyer's country/option selection. The set read at open time is fine.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, merchantPubkey, attempt]),
  );

  return { status, options, retry: () => setAttempt((a) => a + 1) };
}
