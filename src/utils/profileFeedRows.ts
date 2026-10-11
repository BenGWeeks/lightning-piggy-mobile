// Pure shaping of a profile's feed into list rows for the profile page's
// single virtualised list: one row per post, three media tiles per grid row,
// two products per grid row, or one status row (loading / empty). Kept out
// of the screen so the tab → rows logic is unit-testable.
import { extractNoteMedia, type NoteMediaItem } from './noteMedia';
import { isReply, replyTarget, type ReplyTarget } from './nip10';
import type { AuthorFeedEvent } from '../services/authorFeedService';
import type { MarketProduct } from '../data/marketProducts';

export type ProfileTab = 'posts' | 'media' | 'shop';
/** Posts tab filter: top-level posts only (default), or posts and replies. */
export type PostsMode = 'posts' | 'all';

export const MEDIA_COLUMNS = 3;
export const PRODUCT_COLUMNS = 2;

export interface MediaTile {
  key: string;
  eventId: string;
  item: NoteMediaItem;
}

export type ProfileStatus =
  | 'loading'
  | 'emptyPosts'
  | 'onlyReplies'
  | 'emptyMedia'
  | 'emptyShop'
  | 'shopUnavailable';

export type ProfileRow =
  | {
      type: 'post';
      key: string;
      event: AuthorFeedEvent;
      /** Set for replies in "Posts & replies" mode: what it replies to. */
      reply: ReplyTarget | null;
    }
  | { type: 'media'; key: string; tiles: MediaTile[] }
  | { type: 'products'; key: string; products: MarketProduct[] }
  | { type: 'status'; key: string; status: ProfileStatus };

/** Newest first; ties break on id so the order is stable across renders. */
export function sortFeed(events: Iterable<AuthorFeedEvent>): AuthorFeedEvent[] {
  return [...events].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
}

/** Every media item in a (sorted) feed, as grid tiles, de-duplicated by URL. */
export function collectMediaTiles(events: readonly AuthorFeedEvent[]): MediaTile[] {
  const tiles: MediaTile[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    for (const item of extractNoteMedia(event)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      tiles.push({ key: `${event.id}:${item.url}`, eventId: event.id, item });
    }
  }
  return tiles;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export interface ProfileRowsInput {
  tab: ProfileTab;
  /** Posts tab filter; defaults to top-level posts only. */
  postsMode?: PostsMode;
  feed: readonly AuthorFeedEvent[];
  feedLoading: boolean;
  products: readonly MarketProduct[];
  productsLoading: boolean;
  /** The seller snapshot couldn't be completed (relays failed / timed out). */
  productsIncomplete?: boolean;
}

export function buildProfileRows(input: ProfileRowsInput): ProfileRow[] {
  const status = (s: ProfileStatus): ProfileRow[] => [
    { type: 'status', key: `status-${s}`, status: s },
  ];
  if (input.tab === 'shop') {
    if (input.products.length === 0)
      return status(
        input.productsLoading
          ? 'loading'
          : input.productsIncomplete
            ? 'shopUnavailable'
            : 'emptyShop',
      );
    return chunk(input.products, PRODUCT_COLUMNS).map((products) => ({
      type: 'products',
      key: `products-${products[0].id}`,
      products,
    }));
  }
  if (input.tab === 'media') {
    const tiles = collectMediaTiles(input.feed);
    if (tiles.length === 0) return status(input.feedLoading ? 'loading' : 'emptyMedia');
    return chunk(tiles, MEDIA_COLUMNS).map((row) => ({
      type: 'media',
      key: `media-${row[0].key}`,
      tiles: row,
    }));
  }
  const all = input.postsMode === 'all';
  const notes = input.feed.filter((e) => e.kind === 1);
  const posts = all ? notes : notes.filter((e) => !isReply(e));
  if (posts.length === 0) {
    if (input.feedLoading) return status('loading');
    // Only replies loaded so far — point at the other mode.
    return status(notes.length > 0 ? 'onlyReplies' : 'emptyPosts');
  }
  return posts.map((event) => ({
    type: 'post',
    key: event.id,
    event,
    reply: all ? replyTarget(event) : null,
  }));
}

/** Top-level posts in a (sorted) feed — what "Posts" mode can show. */
export function countTopLevelPosts(feed: readonly AuthorFeedEvent[]): number {
  let n = 0;
  for (const e of feed) if (e.kind === 1 && !isReply(e)) n++;
  return n;
}
