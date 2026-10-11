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

/** Review query limit (one review per author per product). */
export const REVIEWS_LIMIT = 500;

export interface FeedbackQueryOptions {
  signal: AbortSignal;
  /** Only events at/after this unix time (incremental refresh). */
  since?: number;
  /** Per-query deadline (ms). */
  maxWait?: number;
}

const withSince = (filter: Filter, since?: number): Filter =>
  since === undefined ? filter : { ...filter, since };

/** Reviews whose `d` is `coord`. Rejects only when every relay failed. */
export function queryReviewEvents(
  relays: string[],
  coord: string,
  { signal, since, maxWait = 4000 }: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  // Register the relays we open so nostrService.cleanup() closes them.
  trackRelays(relays);
  return querySyncAbortable(
    pool,
    relays,
    withSince({ kinds: [REVIEW_KIND], '#d': [coord], limit: REVIEWS_LIMIT }, since),
    { maxWait, signal, rejectOnAllRelaysFailure: true },
  );
}

/**
 * The comment thread rooted on `root`. The `#A` filter is only a relay-side
 * request — only comments whose ROOT tag is this product are returned.
 */
export function queryCommentEvents(
  relays: string[],
  root: CommentRoot,
  { signal, since, maxWait = 5000 }: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  trackRelays(relays);
  return querySyncAbortable(
    pool,
    relays,
    withSince(commentFilterForRoot(root, DEFAULT_COMMENTS_LIMIT), since),
    { maxWait, signal, rejectOnAllRelaysFailure: true },
  ).then((evs) => evs.filter((e) => belongsToRoot(e, root)));
}

function queryDeletions(
  relays: string[],
  filters: Filter[],
  { signal, since, maxWait = 4000 }: FeedbackQueryOptions,
): Promise<NostrEvent[]> {
  return Promise.all(
    filters.map((filter) =>
      querySyncAbortable(pool, relays, withSince(filter, since), { maxWait, signal }),
    ),
  ).then((batches) => batches.flat().filter((e) => e.kind === DELETION_KIND));
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
