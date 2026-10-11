// Reduce a seller's own Market events (#1273) into what "My shop" shows:
// the shop collection, its shipping zones and the user's listings. PURE.
//
// Addressable events: newest revision per `<kind>:<pubkey>:<d>` wins (ties →
// lowest id, the NIP-01 rule the Market reader also uses). NIP-09 deletions
// (kind 5, `a` or `e`) and locally hidden coordinates (deleted on this
// device, waiting for relays to catch up) suppress revisions at or before
// the deletion time.
import type { Event } from 'nostr-tools';
import { parseShippingOptionEvent, type ShippingOption } from './marketShipping';
import {
  COLLECTION_KIND,
  DELETION_KIND,
  LISTING_KIND,
  SHIPPING_OPTION_KIND,
  SHOP_COLLECTION_D,
  coordinateOf,
} from './marketSellerEvents';

export interface SellerSnapshot {
  shop: Event | null;
  /** Valid shipping zones, keyed in published order (oldest first). */
  zones: ShippingOption[];
  /** Raw zone events by coordinate — the `previous` for an edit. */
  zoneEvents: ReadonlyMap<string, Event>;
  /** Newest first. */
  listings: Event[];
}

const SELLER_KINDS = new Set([LISTING_KIND, COLLECTION_KIND, SHIPPING_OPTION_KIND]);

export function reduceSellerSnapshot(
  events: readonly Event[],
  pubkey: string,
  hidden: ReadonlyMap<string, number> = new Map(),
): SellerSnapshot {
  const latest = new Map<string, Event>();
  const deletedIds = new Set<string>();
  const deletedAt = new Map<string, number>(hidden);
  for (const event of events) {
    if (event.pubkey !== pubkey) continue;
    if (event.kind === DELETION_KIND) {
      for (const t of event.tags) {
        if (t[0] === 'e' && t[1]) deletedIds.add(t[1]);
        if (t[0] === 'a' && t[1]?.split(':')[1] === pubkey)
          deletedAt.set(t[1], Math.max(deletedAt.get(t[1]) ?? 0, event.created_at));
      }
      continue;
    }
    if (!SELLER_KINDS.has(event.kind)) continue;
    const d = event.tags.find((t) => t[0] === 'd')?.[1];
    if (!d) continue;
    const key = coordinateOf(event.kind, pubkey, d);
    const previous = latest.get(key);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id < previous.id)
    )
      latest.set(key, event);
  }

  let shop: Event | null = null;
  const zoneEvents = new Map<string, Event>();
  const zones: ShippingOption[] = [];
  const listings: Event[] = [];
  for (const [coordinate, event] of latest) {
    if (deletedIds.has(event.id) || (deletedAt.get(coordinate) ?? -1) >= event.created_at) continue;
    if (event.kind === COLLECTION_KIND) {
      if (coordinate === coordinateOf(COLLECTION_KIND, pubkey, SHOP_COLLECTION_D)) shop = event;
    } else if (event.kind === SHIPPING_OPTION_KIND) {
      const option = parseShippingOptionEvent(event);
      if (option) {
        zones.push(option);
        zoneEvents.set(coordinate, event);
      }
    } else {
      listings.push(event);
    }
  }
  // Show zones in the order the shop lists them, then any stragglers oldest
  // first, so the settings form doesn't reshuffle between edits.
  const order = (shop?.tags ?? []).filter((t) => t[0] === 'shipping_option').map((t) => t[1]);
  zones.sort((a, b) => {
    const ai = order.indexOf(a.coordinate);
    const bi = order.indexOf(b.coordinate);
    if (ai !== bi) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    return a.createdAt - b.createdAt || a.coordinate.localeCompare(b.coordinate);
  });
  listings.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  return { shop, zones, zoneEvents, listings };
}
