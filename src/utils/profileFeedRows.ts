// Pure shaping of a profile's feed into list rows for the profile page's
// single virtualised list: one row per post, three media tiles per grid row,
// two products per grid row, or one status row (loading / empty). Kept out
// of the screen so the tab → rows logic is unit-testable.
import { extractNoteMedia, type NoteMediaItem } from './noteMedia';
import type { AuthorFeedEvent } from '../services/authorFeedService';
import type { MarketProduct } from '../data/marketProducts';

export type ProfileTab = 'posts' | 'media' | 'products';

export const MEDIA_COLUMNS = 3;
export const PRODUCT_COLUMNS = 2;

export interface MediaTile {
  key: string;
  eventId: string;
  item: NoteMediaItem;
}

export type ProfileStatus = 'loading' | 'emptyPosts' | 'emptyMedia' | 'emptyProducts';

export type ProfileRow =
  | { type: 'post'; key: string; event: AuthorFeedEvent }
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
  feed: readonly AuthorFeedEvent[];
  feedLoading: boolean;
  products: readonly MarketProduct[];
  productsLoading: boolean;
}

export function buildProfileRows(input: ProfileRowsInput): ProfileRow[] {
  const status = (s: ProfileStatus): ProfileRow[] => [
    { type: 'status', key: `status-${s}`, status: s },
  ];
  if (input.tab === 'products') {
    if (input.products.length === 0)
      return status(input.productsLoading ? 'loading' : 'emptyProducts');
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
  const posts = input.feed.filter((e) => e.kind === 1);
  if (posts.length === 0) return status(input.feedLoading ? 'loading' : 'emptyPosts');
  return posts.map((event) => ({ type: 'post', key: event.id, event }));
}
