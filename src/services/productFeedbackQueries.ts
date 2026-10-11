// Bounded relay reads for Market product feedback — reviews (kind 31555),
// comments (kind 1111) and their authors' kind-5 deletions (#1272). One
// module so the first load and pull-to-refresh (#1301, which adds `since`)
// issue the same filters. Every read is a one-shot query (closes on EOSE /
// maxWait / abort) — never a long-lived subscription.
import type { Event as NostrEvent, Filter } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import { REVIEW_KIND } from '../utils/productReviews';
import {
  DEFAULT_COMMENTS_LIMIT,
  belongsToRoot,
  commentFilterForRoot,
  type CommentRoot,
} from '../utils/productComments';
import { DELETION_KIND, addressRefs, deletionFilters, idRefs } from '../utils/nip09';
import { hasValidSignature } from '../utils/eventSignature';

/** Review query limit (one review per author per product). */
export const REVIEWS_LIMIT = 500;

export interface FeedbackQueryOptions {
  signal: AbortSignal;
  /** Only events at/after this unix time (incremental refresh). */
  since?: number;
  /** Per-query deadline (ms). */
  maxWait?: number;
  /**
   * Drop events whose signature doesn't check out, instead of trusting the
   * pool's verifier (pull-to-refresh merges with this on, #1301).
   */
  verify?: boolean;
}

const withSince = (filter: Filter, since?: number): Filter =>
  since === undefined ? filter : { ...filter, since };

const signedOnly = (events: NostrEvent[], verify?: boolean): NostrEvent[] =>
  verify ? events.filter(hasValidSignature) : events;

/** Reviews whose `d` is `coord`. Rejects only when every relay failed. */
export function queryReviewEvents(
  relays: string[],
  coord: string,
  { signal, since, maxWait = 4000, verify }: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  // Register the relays we open so nostrService.cleanup() closes them.
  trackRelays(relays);
  return querySyncAbortable(
    pool,
    relays,
    withSince({ kinds: [REVIEW_KIND], '#d': [coord], limit: REVIEWS_LIMIT }, since),
    { maxWait, signal, rejectOnAllRelaysFailure: true },
  ).then((evs) => signedOnly(evs, verify));
}

/**
 * The comment thread rooted on `root`. The `#A` filter is only a relay-side
 * request — only comments whose ROOT tag is this product are returned.
 */
export function queryCommentEvents(
  relays: string[],
  root: CommentRoot,
  { signal, since, maxWait = 5000, verify }: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  trackRelays(relays);
  return querySyncAbortable(
    pool,
    relays,
    withSince(commentFilterForRoot(root, DEFAULT_COMMENTS_LIMIT), since),
    { maxWait, signal, rejectOnAllRelaysFailure: true },
  ).then((evs) =>
    signedOnly(
      evs.filter((e) => belongsToRoot(e, root)),
      verify,
    ),
  );
}

function queryDeletions(
  relays: string[],
  filters: Filter[],
  { signal, since, maxWait = 4000, verify }: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  return Promise.all(
    filters.map((filter) =>
      querySyncAbortable(pool, relays, withSince(filter, since), { maxWait, signal }),
    ),
  ).then((batches) =>
    signedOnly(
      batches.flat().filter((e) => e.kind === DELETION_KIND),
      verify,
    ),
  );
}

/** Author kind-5s naming `reviews` by address (replaceable) or by id. */
export function queryReviewDeletions(
  relays: string[],
  reviews: NostrEvent[],
  opts: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  return queryDeletions(
    relays,
    [...deletionFilters('a', addressRefs(reviews)), ...deletionFilters('e', idRefs(reviews))],
    opts,
  );
}

/** Author kind-5s naming `comments` by id (never `a` — see commentEdits). */
export function queryCommentDeletions(
  relays: string[],
  comments: NostrEvent[],
  opts: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  return queryDeletions(relays, deletionFilters('e', idRefs(comments)), opts);
}
