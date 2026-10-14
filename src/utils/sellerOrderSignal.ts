// "Is this incoming Gamma message about MY shop?" — the seller's exception to
// the DM follow gate. PURE (coverage scope: src/utils).
//
// Lightning Piggy drops NIP-17 messages from people the user doesn't follow
// (parental control) and keeps plaintext market events silent unless the
// sender is known. For a seller that hides real orders: a first-time buyer is
// by definition a stranger. An order whose EVERY `item` names one of the
// seller's OWN current kind-30402 listings is a legitimate signal, so it is
// stored and notified even from a stranger. Anything else — orders for
// listings the user doesn't own, malformed refs, mixed carts — keeps the gate.
import { parseOrderEvent, type OrderEventInput, type ParsedOrderEvent } from './orderEvents';
import { parseCoordinate } from './sellerOrderQuote';

export interface OwnListingOrderLine {
  title: string;
  quantity: number;
}

/** Cheap pre-check before any storage lookup: a type-1 order naming at least
 * one listing authored by `viewer`. */
export function mightBeOwnListingOrder(rumor: OrderEventInput, viewer: string): boolean {
  if (rumor.kind !== 16) return false;
  const order = parseOrderEvent(rumor);
  if (!order || order.type !== 'order') return false;
  const me = viewer.toLowerCase();
  return order.items.some((i) => parseCoordinate(i.ref, 30402)?.pubkey === me);
}

/**
 * The order's lines when every item is one of `viewer`'s current listings
 * (`index`: `30402:<viewer>:<d>` → title), else null.
 */
export function ownListingOrderLines(
  order: ParsedOrderEvent,
  viewer: string,
  index: ReadonlyMap<string, string>,
): OwnListingOrderLine[] | null {
  if (order.kind !== 16 || order.type !== 'order' || order.items.length === 0) return null;
  const me = viewer.toLowerCase();
  const lines: OwnListingOrderLine[] = [];
  for (const item of order.items) {
    const coord = parseCoordinate(item.ref, 30402);
    if (!coord || coord.pubkey !== me) return null;
    const title = index.get(`30402:${me}:${coord.dTag}`);
    if (title === undefined) return null;
    lines.push({ title, quantity: item.quantity });
  }
  return lines;
}

/** A buyer's follow-up (kind-17 receipt / type-3 status) for an order this
 * seller already invoiced from this device. */
export function isFollowUpForOwnOrder(
  order: ParsedOrderEvent,
  invoicedOrderIds: ReadonlySet<string>,
): boolean {
  return (
    (order.type === 'receipt' || order.type === 'status') && invoicedOrderIds.has(order.orderId)
  );
}

/** Notification body: "Mug × 2, Hat × 1" (capped). */
export function orderLinesSummary(lines: readonly OwnListingOrderLine[], max = 3): string {
  const shown = lines.slice(0, max).map((l) => `${l.title} × ${l.quantity}`);
  return lines.length > max ? `${shown.join(', ')}, …` : shown.join(', ');
}
