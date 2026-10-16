import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Event } from 'nostr-tools';
import {
  loadedMarketSnapshots,
  readLoadedMarketSnapshots,
  subscribeMarketSnapshots,
} from '../services/marketStorage';
import { hasOwnMarketListings } from '../utils/marketShortcutCounts';

/** Reuse verified local catalogues, including listings visible before the seller hub loads. */
export function useKnownOwnListings(pubkey: string | null, sellerListings: readonly Event[]) {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeMarketSnapshots(() => setRevision((value) => value + 1)), []);
  useFocusEffect(
    useCallback(() => {
      if (pubkey) void readLoadedMarketSnapshots(pubkey);
    }, [pubkey]),
  );
  return useMemo(
    () =>
      hasOwnMarketListings(pubkey, [
        ...sellerListings,
        ...loadedMarketSnapshots(pubkey ? [pubkey] : []).flatMap(({ products }) =>
          products.flatMap((product) => (product.listing ? [product.listing.event] : [])),
        ),
      ]),
    // revision signals a local catalogue change, including account wipes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkey, sellerListings, revision],
  );
}
