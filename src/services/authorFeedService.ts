// Relay reads for one author's public feed on their profile page: kind-1
// notes plus NIP-68 / NIP-71 picture and video events. The live
// subscription fetches the newest page; older pages come from a bounded,
// abortable `until` query. Every filter carries a `limit`.
import type { Event, Filter } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import { PROFILE_FEED_KINDS } from '../utils/noteMedia';

export type AuthorFeedEvent = Pick<
  Event,
  'id' | 'pubkey' | 'kind' | 'created_at' | 'content' | 'tags'
>;

export const AUTHOR_FEED_PAGE_SIZE = 30;
const PAGE_TIMEOUT_MS = 6000;

const toFeedEvent = (ev: Event): AuthorFeedEvent => ({
  id: ev.id,
  pubkey: ev.pubkey,
  kind: ev.kind,
  created_at: ev.created_at,
  content: ev.content,
  tags: ev.tags,
});

const feedFilter = (authorPubkey: string, limit: number, until?: number): Filter => ({
  kinds: PROFILE_FEED_KINDS,
  authors: [authorPubkey],
  limit,
  ...(until !== undefined ? { until } : {}),
});

/**
 * Live subscription for the newest `limit` feed events. `onEose` fires once,
 * after every relay has sent its stored events; the sub stays open for new
 * posts until the returned closer runs. The shared pool verifies signatures
 * for these kinds, and the author is re-checked here (relays can ignore
 * `authors`).
 */
export function subscribeAuthorFeed(input: {
  authorPubkey: string;
  relays: string[];
  limit?: number;
  onEvent: (event: AuthorFeedEvent) => void;
  onEose?: () => void;
}): () => void {
  trackRelays(input.relays);
  let eoseFired = false;
  const sub = pool.subscribeMany(
    input.relays,
    feedFilter(input.authorPubkey, input.limit ?? AUTHOR_FEED_PAGE_SIZE),
    {
      onevent: (ev: Event) => {
        if (ev.pubkey !== input.authorPubkey || !PROFILE_FEED_KINDS.includes(ev.kind)) return;
        input.onEvent(toFeedEvent(ev));
      },
      oneose: () => {
        if (eoseFired) return;
        eoseFired = true;
        input.onEose?.();
      },
    },
  );
  return () => {
    try {
      sub.close();
    } catch {
      // best-effort — the sub may already be closed
    }
  };
}

/** One older page: events at or before `until`, newest first, bounded. */
export async function fetchAuthorFeedPage(input: {
  authorPubkey: string;
  relays: string[];
  until: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<AuthorFeedEvent[]> {
  if (input.relays.length === 0) return [];
  trackRelays(input.relays);
  const events = await querySyncAbortable(
    pool,
    input.relays,
    feedFilter(input.authorPubkey, input.limit ?? AUTHOR_FEED_PAGE_SIZE, input.until),
    { maxWait: PAGE_TIMEOUT_MS, signal: input.signal },
  );
  return events
    .filter((ev) => ev.pubkey === input.authorPubkey && PROFILE_FEED_KINDS.includes(ev.kind))
    .map(toFeedEvent)
    .sort((a, b) => b.created_at - a.created_at);
}
