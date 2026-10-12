import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { isLegacyShopCollection } from './marketCollections';
export function collectionCoordinate(event: Pick<Event, 'pubkey' | 'tags'>): string {
  return `30405:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
}
/** Collection lists and listing collection references both support discovery.
 * Membership alone never cascades shipping or location to a product. */
export function productsInCollection(
  products: readonly MarketProduct[],
  collection: Event | null,
): MarketProduct[] {
  if (!collection) return [...products];
  const coordinate = collectionCoordinate(collection);
  const members = new Set(collection.tags.filter((t) => t[0] === 'a').map((t) => t[1]));
  return products.filter((p) => {
    const event = p.listing?.event;
    if (!event || event.kind !== 30402) return false;
    const address = `30402:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
    return members.has(address) || event.tags.some((t) => t[0] === 'a' && t[1] === coordinate);
  });
}
export function visibleCollections(events: Event[]): Event[] {
  return events.filter(
    (e) => !isLegacyShopCollection(e) && e.tags.some((t) => t[0] === 'title' && t[1]),
  );
}
