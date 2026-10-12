// Test fixtures ONLY: reproduce pre-1376 shop-name events for migration regressions.
import type { Event } from 'nostr-tools';
import type { ShippingOption } from './marketShipping';
import {
  COLLECTION_KIND,
  SHOP_COLLECTION_D,
  SELLER_CURRENCIES,
  normaliseCurrency,
  type EventTemplate,
} from './marketSellerEvents';
interface LegacyShopDraft {
  name: string;
  description: string;
  currency: string;
}
const tagValue = (tags: readonly string[][], name: string) => tags.find((t) => t[0] === name)?.[1];
/** The shop collection: references every product and every zone. The
 * `currency` tag is a Lightning Piggy extension (the spec has no shop-level
 * currency); other clients ignore unknown tags. */
export function buildShopTemplate(input: {
  shop: LegacyShopDraft;
  pubkey: string;
  productCoordinates: readonly string[];
  zoneCoordinates: readonly string[];
  previous?: Event | null;
}): EventTemplate {
  const tags: string[][] = [
    ['d', SHOP_COLLECTION_D],
    ['title', input.shop.name.trim()],
  ];
  for (const coord of new Set(input.productCoordinates)) tags.push(['a', coord]);
  for (const coord of new Set(input.zoneCoordinates)) tags.push(['shipping_option', coord]);
  tags.push(['currency', normaliseCurrency(input.shop.currency)]);
  const managed = new Set(['d', 'title', 'a', 'shipping_option', 'currency']);
  tags.push(...(input.previous?.tags ?? []).filter((t) => !managed.has(t[0])));
  return { kind: COLLECTION_KIND, content: input.shop.description.trim(), tags };
}

/** The shop collection back into the settings form. */
export function parseShopDraft(
  event: Pick<Event, 'tags' | 'content'> | null,
  zones: readonly ShippingOption[],
): LegacyShopDraft | null {
  if (!event) return null;
  const tagged = tagValue(event.tags, 'currency')?.toUpperCase();
  const currency =
    tagged && SELLER_CURRENCIES.includes(tagged) ? tagged : (zones[0]?.currency ?? 'SATS');
  return {
    name: tagValue(event.tags, 'title') ?? '',
    description: event.content,
    currency: currency === 'SAT' ? 'SATS' : currency,
  };
}
