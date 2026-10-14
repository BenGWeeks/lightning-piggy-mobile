// The signed-in seller's own current kind-30402 listings as a coordinate →
// title index, for the order follow-gate exception (utils/sellerOrderSignal).
// Reads the shared seller store when it's populated this session, else the
// persisted, signature-verified seller cache (marketSellerService) — no relay
// query on the DM ingest path. Listings published only from another client
// and never loaded in My shop on this device aren't known here; their orders
// keep the normal gate.
import type { Event } from 'nostr-tools';
import { loadHiddenListings, loadSellerCache } from './marketSellerService';
import { isSellerAccountForgotten, sellerStoreState } from './sellerEventStore';
import { loadSellerInvoices } from './sellerInvoiceStore';
import { reduceSellerSnapshot } from '../utils/marketSellerSnapshot';
import { parseOrderEvent, type OrderEventInput } from '../utils/orderEvents';
import {
  isFollowUpForOwnOrder,
  mightBeOwnListingOrder,
  ownListingOrderLines,
  type OwnListingOrderLine,
} from '../utils/sellerOrderSignal';

export async function ownListingIndex(pubkey: string): Promise<Map<string, string>> {
  const me = pubkey.toLowerCase();
  // A signed-out account must not be re-created by a late DM.
  if (isSellerAccountForgotten(me)) return new Map();
  const state = sellerStoreState(me);
  let events: readonly Event[] = [...state.events.values()];
  let hidden: ReadonlyMap<string, number> = state.hidden;
  if (events.length === 0) {
    [events, hidden] = await Promise.all([loadSellerCache(me), loadHiddenListings(me)]);
  }
  const index = new Map<string, string>();
  for (const listing of reduceSellerSnapshot(events, me, hidden).listings) {
    if (listing.kind !== 30402) continue;
    const d = listing.tags.find((t) => t[0] === 'd')?.[1];
    if (!d) continue;
    const title = listing.tags.find((t) => t[0] === 'title')?.[1]?.trim() || d;
    index.set(`30402:${me}:${d}`, title);
  }
  return index;
}

export type SellerOrderSignal =
  | { kind: 'order'; lines: OwnListingOrderLine[] }
  | { kind: 'followUp' }
  | null;

/**
 * Whether an incoming kind-16/17 rumor is a legitimate shop signal that
 * should pass the follow gate: a new order for the seller's own listings, or
 * a follow-up to an order they invoiced. Null for everything else.
 */
export async function sellerOrderSignal(
  rumor: OrderEventInput & { pubkey?: string },
  viewer: string,
): Promise<SellerOrderSignal> {
  if (rumor.kind !== 16 && rumor.kind !== 17) return null;
  if (rumor.pubkey?.toLowerCase() === viewer.toLowerCase()) return null;
  const order = parseOrderEvent(rumor);
  if (!order) return null;
  try {
    if (order.type === 'order') {
      if (!mightBeOwnListingOrder(rumor, viewer)) return null;
      const lines = ownListingOrderLines(order, viewer, await ownListingIndex(viewer));
      return lines ? { kind: 'order', lines } : null;
    }
    const invoiced = new Set(Object.keys(await loadSellerInvoices(viewer.toLowerCase())));
    return isFollowUpForOwnOrder(order, invoiced) ? { kind: 'followUp' } : null;
  } catch {
    return null;
  }
}
