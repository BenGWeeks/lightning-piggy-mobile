import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Event as NostrEvent } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS, pool } from '../services/nostrService';
import { querySyncAbortable } from '../services/relayQuery';
import {
  REVIEW_KIND,
  aggregateReviews,
  parseReviews,
  type ParsedReview,
  type ReviewAggregate,
} from '../utils/productReviews';

export interface UseProductReviews {
  reviews: ParsedReview[];
  aggregate: ReviewAggregate;
  loading: boolean;
  /**
   * True when the relay query failed. The user-facing copy is localized at the
   * render layer (`market.reviews.loadError`) rather than baked in here, so the
   * message follows the app's selected locale.
   */
  error: boolean;
  refetch: () => void;
}

/**
 * Live product reviews (Nostr kind 31555) for a review coordinate
 * `a:30402:<merchant>:<dTag>`. Queries the user's read relays, then parses +
 * aggregates via the pure {@link parseReviews}/{@link aggregateReviews}
 * helpers. `coord` null (seller has no Nostr identity) yields an empty set.
 */
export function useProductReviews(coord: string | null): UseProductReviews {
  const { relays } = useNostr();
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const readRelays = useMemo(() => {
    const r = relays.filter((x) => x.read).map((x) => x.url);
    return r.length > 0 ? r : DEFAULT_RELAYS;
  }, [relays]);

  // Focus-armed (repo rule: screens arm relay work with useFocusEffect, never
  // a bare useEffect): the Explore stack uses freezeOnBlur, so a blurred
  // product page must abort its in-flight query rather than let it run to
  // its maxWait; refocus re-runs the (cheap, bounded) query.
  useFocusEffect(
    useCallback(() => {
      if (!coord) {
        setEvents([]);
        setLoading(false);
        setError(false);
        return;
      }
      const controller = new AbortController();
      setLoading(true);
      setError(false);
      querySyncAbortable(
        pool,
        readRelays,
        { kinds: [REVIEW_KIND], '#d': [coord], limit: 500 },
        { maxWait: 4000, signal: controller.signal, rejectOnAllRelaysFailure: true },
      )
        .then((evs) => {
          if (!controller.signal.aborted) setEvents(evs);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => controller.abort();
    }, [coord, readRelays, tick]),
  );

  // Exact `d` scoping: the `#d` filter is only a relay-side request, so a
  // review a relay returns for another product must not count here.
  const reviews = useMemo(() => parseReviews(events, coord ?? undefined), [events, coord]);
  const aggregate = useMemo(() => aggregateReviews(reviews), [reviews]);

  return { reviews, aggregate, loading, error, refetch };
}
