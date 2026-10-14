import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { Toast } from '../components/BrandedToast';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { fetchListingLikes } from '../services/marketLikesService';
import { MARKET_RELAYS } from '../utils/marketListingsQuery';
import {
  LIKE_CONTENT,
  LISTING_KIND,
  LISTING_RELAY_HINT,
  listingCoordinate,
} from '../utils/marketLikes';
import type { MarketProduct } from '../data/marketProducts';

interface LikeState {
  /** People with an active like; null until the first fetch lands. */
  count: number | null;
  /** The viewer's active like ids — Unlike retracts all of them. */
  myIds: string[];
}

const EMPTY: LikeState = { count: null, myIds: [] };

/**
 * Like / Unlike for a kind-30402 Market listing (#1541). The count and the
 * viewer's own like are fetched on screen focus (no live subscription); a tap
 * updates optimistically, then publishes a NIP-25 reaction (Like) or a NIP-09
 * deletion of the viewer's own reactions (Unlike), rolling back with a toast
 * if publishing fails. `coordinate` is null for products that can't be liked
 * (curated catalogue items, NIP-15 products).
 */
export function useListingLike(product: MarketProduct, onRequestSignIn: () => void) {
  const t = useTranslation();
  const { pubkey, relays, publishReaction, deleteReaction } = useNostr();
  const event = product.listing?.event;
  const coordinate = event ? listingCoordinate(event) : null;
  const readRelays = useMemo(() => {
    const r = relays.filter((x) => x.read).map((x) => x.url);
    return r.length > 0 ? r : DEFAULT_RELAYS;
  }, [relays]);
  const [state, setState] = useState<LikeState>(EMPTY);
  // A fetch that lands mid-toggle must not overwrite the optimistic state.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!coordinate) return undefined;
      const controller = new AbortController();
      fetchListingLikes(coordinate, pubkey, readRelays, controller.signal)
        .then((likes) => {
          if (controller.signal.aborted || busyRef.current) return;
          setState({ count: likes.count, myIds: likes.myReactionIds });
        })
        .catch(() => {
          // Every relay failed: keep what's shown; the heart still works.
        });
      return () => controller.abort();
    }, [coordinate, pubkey, readRelays]),
  );

  const liked = state.myIds.length > 0;

  const toggle = useCallback(async () => {
    if (!event || !coordinate || busyRef.current) return;
    if (!pubkey) {
      onRequestSignIn();
      return;
    }
    const before = state;
    busyRef.current = true;
    setBusy(true);
    const fail = () => {
      setState(before);
      Toast.show({
        type: 'error',
        text1: liked ? t('market.like.unlikeFailed') : t('market.like.likeFailed'),
      });
    };
    try {
      if (!liked) {
        setState({ count: (before.count ?? 0) + 1, myIds: ['pending'] });
        const id = await publishReaction({
          emoji: LIKE_CONTENT,
          targetEventId: event.id,
          targetAuthorPubkey: event.pubkey,
          targetEventKind: LISTING_KIND,
          targetAddress: { coordinate, relayHint: LISTING_RELAY_HINT },
          extraRelays: MARKET_RELAYS,
        });
        if (id) setState({ count: (before.count ?? 0) + 1, myIds: [id] });
        else fail();
      } else {
        setState({ count: Math.max(0, (before.count ?? 1) - 1), myIds: [] });
        const results = await Promise.all(
          before.myIds.map((id) => deleteReaction(id, MARKET_RELAYS)),
        );
        const remaining = before.myIds.filter((_, i) => !results[i]);
        if (remaining.length > 0) {
          setState({ count: before.count, myIds: remaining });
          Toast.show({ type: 'error', text1: t('market.like.unlikeFailed') });
        }
      }
    } catch {
      fail();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [
    event,
    coordinate,
    pubkey,
    state,
    liked,
    publishReaction,
    deleteReaction,
    onRequestSignIn,
    t,
  ]);

  return { available: !!coordinate, liked, count: state.count, busy, toggle };
}
