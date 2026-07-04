import { useCallback, useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
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
      { maxWait: 4000, signal: controller.signal },
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
  }, [coord, readRelays, tick]);

  const reviews = useMemo(() => parseReviews(events), [events]);
  const aggregate = useMemo(() => aggregateReviews(reviews), [reviews]);

  return { reviews, aggregate, loading, error, refetch };
}
