import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMarketMerchantProfiles } from '../services/marketMerchantProfiles';
import type { CachedZapSenderProfile } from '../services/zapSenderProfileStorage';

const EMPTY: ReadonlyMap<string, CachedZapSenderProfile> = new Map();

/**
 * Names and avatars for the buyers on the seller's Orders screen (#1534).
 * One cache-first, bounded kind-0 pass per focus (the Market's merchant
 * profile fetch). No subscription and no per-row requests.
 */
export function useBuyerProfiles(buyersKey: string): ReadonlyMap<string, CachedZapSenderProfile> {
  const [state, setState] = useState<{
    key: string;
    profiles: ReadonlyMap<string, CachedZapSenderProfile>;
  }>({ key: '', profiles: EMPTY });
  useFocusEffect(
    useCallback(() => {
      if (!buyersKey) return;
      const controller = new AbortController();
      fetchMarketMerchantProfiles(buyersKey.split(','), controller.signal)
        .then((profiles) => {
          if (!controller.signal.aborted) setState({ key: buyersKey, profiles });
        })
        .catch(() => {});
      return () => controller.abort();
    }, [buyersKey]),
  );
  return state.profiles;
}
