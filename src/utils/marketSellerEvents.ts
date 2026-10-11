// Seller-side event building + parsing for the Market (#1273). PURE — no
// React, no I/O — so every byte we sign is unit-tested.
//
// Format: the Gamma Markets spec (NIP-99 based,
// https://github.com/GammaMarkets/market-spec), the same events the Market
// reader (`marketListings.ts`) and the buyer checkout (`marketShipping.ts`,
// `orderEvents.ts`) already consume, and what Robotechy and Eden Weeks
// publish in the wild:
//
//   kind 30402  product listing   d, title, price, type, visibility, stock,
//                                 image × n, t × n, shipping_option × n,
//                                 a → the shop collection, published_at
//   kind 30406  shipping option   one per zone: d, title, price, country,
//                                 service
//   kind 30405  collection        "your shop": title, description, a → every
//                                 product, shipping_option → every zone
//   kind 5      NIP-09 deletion   a + e + k
//
// Edits republish the addressable event under the SAME `d`, and keep any tag
// we don't manage (summary, spec, weight, another client's extensions …) so
// editing a listing made in another Gamma client doesn't strip its data.
import type { Event } from 'nostr-tools';
import { CURRENCIES } from '../services/fiatService';
import { isKnownCountry } from '../data/countries';
import { SHIPPING_OPTION_KIND, type ShippingOption } from './marketShipping';

export const LISTING_KIND = 30402;
export const COLLECTION_KIND = 30405;
export const DELETION_KIND = 5;
export { SHIPPING_OPTION_KIND };

/** `d` of the one collection that represents the user's shop. */
export const SHOP_COLLECTION_D = 'lightning-piggy-shop';
/** Currencies a seller may price in: sats first, then the app's fiat list. */
export const SELLER_CURRENCIES: readonly string[] = ['SATS', ...CURRENCIES];
export const MAX_LISTING_IMAGES = 8;
export const MAX_LISTING_CATEGORIES = 10;
export const MAX_SHIPPING_ZONES = 10;

export interface EventTemplate {
  kind: number;
  content: string;
  tags: string[][];
}

/** The shop as the user edits it (the 30405 collection's display fields). */
export interface ShopDraft {
  name: string;
  description: string;
  /** Default currency for listings and the currency every zone cost is in. */
  currency: string;
}

/** One shipping zone (a 30406 option). Its cost is in the shop currency. */
export interface ShippingZoneDraft {
  dTag: string;
  name: string;
  /** ISO 3166-1 alpha-2 codes; EMPTY = worldwide. */
  countries: string[];
  /** Decimal string, e.g. "3.50". */
  cost: string;
}

/** A listing's link to one shipping option plus its per-product surcharge. */
export interface ListingShippingDraft {
  coordinate: string;
  /** Decimal string in the LISTING's currency (spec), '' = no surcharge. */
  extraCost: string;
}

export interface ListingDraft {
  dTag: string;
  title: string;
  description: string;
  images: string[];
  price: string;
  currency: string;
  /** Integer string; '' = stock not tracked. */
  quantity: string;
  categories: string[];
  shipping: ListingShippingDraft[];
}

export type SellerDraftError =
  | 'title'
  | 'price'
  | 'currency'
  | 'quantity'
  | 'images'
  | 'categories'
  | 'shipping'
  | 'shopName'
  | 'zones'
  | 'zoneName'
  | 'zoneCost'
  | 'zoneCountries';

const tagValue = (tags: readonly string[][], name: string) => tags.find((t) => t[0] === name)?.[1];

/** Fresh addressable identifier, e.g. `item-m1x2y3-k9f2ab`. */
export function newIdentifier(
  prefix: string,
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  const suffix = random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}-${now.toString(36)}-${suffix}`;
}

/**
 * A user-typed amount as the spec's decimal string ("10.99"), or null when it
 * isn't one. Accepts a comma decimal separator (most of Europe types "3,50").
 * Sats must be whole.
 */
export function normaliseAmount(raw: string, currency: string): string | null {
  const value = raw.trim().replace(',', '.');
  if (!/^\d{1,12}(\.\d{1,8})?$/.test(value)) return null;
  const isSats = ['SATS', 'SAT'].includes(currency.toUpperCase());
  if (isSats && value.includes('.')) return null;
  // Drop redundant leading zeros ("007" → "7") but keep "0.50".
  return value.replace(/^0+(?=\d)/, '');
}

/** Normalise categories: trimmed, lower-case, de-duplicated, no '#'. */
export function normaliseCategories(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    const value = entry.trim().replace(/^#+/, '').toLowerCase();
    if (value && value.length <= 40 && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Split a comma / newline separated categories field. */
export function splitCategories(text: string): string[] {
  return normaliseCategories(text.split(/[,\n]/));
}

export function validateListingDraft(draft: ListingDraft): SellerDraftError[] {
  const errors: SellerDraftError[] = [];
  const title = draft.title.trim();
  if (!title || title.length > 200) errors.push('title');
  if (!SELLER_CURRENCIES.includes(draft.currency.toUpperCase())) errors.push('currency');
  else if (normaliseAmount(draft.price, draft.currency) === null) errors.push('price');
  const quantity = draft.quantity.trim();
  if (quantity && (!/^\d{1,9}$/.test(quantity) || Number(quantity) > 1e9)) errors.push('quantity');
  if (draft.images.length > MAX_LISTING_IMAGES || draft.images.some((u) => !isHttpsUrl(u)))
    errors.push('images');
  if (draft.categories.length > MAX_LISTING_CATEGORIES) errors.push('categories');
  if (
    draft.shipping.some(
      (s) =>
        !/^3040[56]:[0-9a-f]{64}:.+/.test(s.coordinate) ||
        (s.extraCost.trim() !== '' && normaliseAmount(s.extraCost, draft.currency) === null),
    )
  )
    errors.push('shipping');
  return errors;
}

export function validateShop(
  shop: ShopDraft,
  zones: readonly ShippingZoneDraft[],
): SellerDraftError[] {
  const errors: SellerDraftError[] = [];
  const name = shop.name.trim();
  if (!name || name.length > 100) errors.push('shopName');
  if (!SELLER_CURRENCIES.includes(shop.currency.toUpperCase())) errors.push('currency');
  if (zones.length > MAX_SHIPPING_ZONES) errors.push('zones');
  if (zones.some((z) => !z.name.trim() || z.name.trim().length > 100)) errors.push('zoneName');
  if (zones.some((z) => normaliseAmount(z.cost, shop.currency) === null)) errors.push('zoneCost');
  if (zones.some((z) => z.countries.some((c) => !isKnownCountry(c)))) errors.push('zoneCountries');
  return errors;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** created_at for a revision: never at or before the one it replaces, so a
 * quick second edit can't lose the replaceable-event tie-break. */
export function nextCreatedAt(nowSeconds: number, previous?: Pick<Event, 'created_at'> | null) {
  const now = Math.floor(nowSeconds);
  return previous ? Math.max(now, previous.created_at + 1) : now;
}

/** Keep the previous revision's tags we don't manage. */
function preservedTags(previous: Event | null | undefined, managed: (tag: string[]) => boolean) {
  return previous ? previous.tags.filter((t) => !managed(t)).map((t) => [...t]) : [];
}

export const coordinateOf = (kind: number, pubkey: string, dTag: string) =>
  `${kind}:${pubkey}:${dTag}`;

export const shopCoordinate = (pubkey: string) =>
  coordinateOf(COLLECTION_KIND, pubkey, SHOP_COLLECTION_D);

/** kind-30406 shipping option for one zone. Worldwide (no countries) omits
 * the `country` tag — the Market reader treats an absent tag as worldwide and
 * rejects an empty one. */
export function buildShippingZoneTemplate(
  zone: ShippingZoneDraft,
  currency: string,
  previous?: Event | null,
): EventTemplate {
  const cost = normaliseAmount(zone.cost, currency);
  if (cost === null) throw new Error('Invalid shipping cost');
  const countries = [...new Set(zone.countries.map((c) => c.trim().toUpperCase()))].filter(Boolean);
  const tags: string[][] = [
    ['d', zone.dTag],
    ['title', zone.name.trim()],
    ['price', cost, currency.toUpperCase()],
  ];
  if (countries.length > 0) tags.push(['country', ...countries]);
  const service = tagValue(previous?.tags ?? [], 'service') ?? 'standard';
  tags.push(['service', service]);
  const managed = new Set(['d', 'title', 'price', 'country', 'service']);
  tags.push(...preservedTags(previous, (t) => managed.has(t[0])));
  return { kind: SHIPPING_OPTION_KIND, content: previous?.content ?? '', tags };
}

/** The shop collection: references every product and every zone. The
 * `currency` tag is a Lightning Piggy extension (the spec has no shop-level
 * currency); other clients ignore unknown tags. */
export function buildShopTemplate(input: {
  shop: ShopDraft;
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
  tags.push(['currency', input.shop.currency.toUpperCase()]);
  const managed = new Set(['d', 'title', 'a', 'shipping_option', 'currency']);
  tags.push(...preservedTags(input.previous, (t) => managed.has(t[0])));
  return { kind: COLLECTION_KIND, content: input.shop.description.trim(), tags };
}

/** kind-30402 product listing. */
export function buildListingTemplate(input: {
  draft: ListingDraft;
  pubkey: string;
  nowSeconds: number;
  previous?: Event | null;
}): EventTemplate {
  const { draft, pubkey, previous } = input;
  const currency = draft.currency.toUpperCase();
  const price = normaliseAmount(draft.price, currency);
  if (price === null) throw new Error('Invalid price');
  const prevTags = previous?.tags ?? [];
  const prevType = prevTags.find((t) => t[0] === 'type');
  const prevFrequency = prevTags.find((t) => t[0] === 'price')?.[3];
  const shop = shopCoordinate(pubkey);
  const shipping = draft.shipping.filter(
    (s, i, all) => all.findIndex((o) => o.coordinate === s.coordinate) === i,
  );
  const tags: string[][] = [
    ['d', draft.dTag],
    ['title', draft.title.trim()],
    // Keep a subscription interval (4th element) the editor doesn't expose.
    prevFrequency ? ['price', price, currency, prevFrequency] : ['price', price, currency],
    [
      'type',
      prevType?.[1] || 'simple',
      // Shipping implies physical; otherwise keep the published format
      // (a physical item can be collect-in-person), defaulting to digital.
      shipping.length > 0 ? 'physical' : prevType?.[2] || 'digital',
    ],
    ['visibility', tagValue(prevTags, 'visibility') || 'on-sale'],
  ];
  const quantity = draft.quantity.trim();
  if (quantity) tags.push(['stock', String(Number(quantity))]);
  draft.images.forEach((url, i) => tags.push(['image', url, '', String(i)]));
  for (const category of normaliseCategories(draft.categories)) tags.push(['t', category]);
  for (const s of shipping) {
    const extra = s.extraCost.trim() ? normaliseAmount(s.extraCost, currency) : null;
    tags.push(
      extra && Number(extra) > 0
        ? ['shipping_option', s.coordinate, extra]
        : ['shipping_option', s.coordinate],
    );
  }
  tags.push(['a', shop]);
  tags.push(['published_at', tagValue(prevTags, 'published_at') ?? String(input.nowSeconds)]);
  const managed = new Set([
    'd',
    'title',
    'price',
    'type',
    'visibility',
    'stock',
    'image',
    't',
    'shipping_option',
    'published_at',
  ]);
  tags.push(
    ...preservedTags(previous, (t) => managed.has(t[0]) || (t[0] === 'a' && t[1] === shop)),
  );
  return { kind: LISTING_KIND, content: draft.description.trim(), tags };
}

/** A published listing back into the editor's draft. */
export function parseListingDraft(event: Pick<Event, 'tags' | 'content'>): ListingDraft {
  const images = event.tags
    .filter((t) => t[0] === 'image' && typeof t[1] === 'string' && t[1])
    .map((t, index) => ({
      url: t[1],
      order:
        Number.isFinite(Number(t[3])) && t[3] !== '' && t[3] !== undefined ? Number(t[3]) : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((i) => i.url);
  const price = event.tags.find((t) => t[0] === 'price');
  return {
    dTag: tagValue(event.tags, 'd') ?? '',
    title: tagValue(event.tags, 'title') ?? '',
    description: event.content,
    images: [...new Set(images)],
    price: price?.[1] ?? '',
    currency: (price?.[2] ?? 'SATS').toUpperCase(),
    quantity: tagValue(event.tags, 'stock') ?? '',
    categories: normaliseCategories(event.tags.filter((t) => t[0] === 't').map((t) => t[1] ?? '')),
    shipping: event.tags
      .filter((t) => t[0] === 'shipping_option' && typeof t[1] === 'string')
      .map((t) => ({ coordinate: t[1], extraCost: t[2] ?? '' })),
  };
}

/** The shop collection back into the settings form. */
export function parseShopDraft(
  event: Pick<Event, 'tags' | 'content'> | null,
  zones: readonly ShippingOption[],
): ShopDraft | null {
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

export function zoneDraftFromOption(option: ShippingOption): ShippingZoneDraft {
  return {
    dTag: option.dTag,
    name: option.title,
    countries: [...option.countries],
    cost: String(option.baseAmount),
  };
}

/** NIP-09 deletion for addressable events: `a` (every revision), `e` (the
 * exact revision, for relays that only index ids) and `k`. */
export function buildDeletionTemplate(
  targets: readonly { kind: number; coordinate: string; eventId?: string }[],
): EventTemplate {
  const tags: string[][] = [];
  for (const target of targets) {
    tags.push(['a', target.coordinate]);
    if (target.eventId) tags.push(['e', target.eventId]);
  }
  for (const kind of new Set(targets.map((t) => t.kind))) tags.push(['k', String(kind)]);
  return { kind: DELETION_KIND, content: '', tags };
}

/** Quick-pick regions for a shipping zone (ISO 3166-1 alpha-2). */
export const SHIPPING_REGION_PRESETS = {
  worldwide: [] as string[],
  uk: ['GB'],
  // The 27 EU member states.
  eu: [
    'AT',
    'BE',
    'BG',
    'HR',
    'CY',
    'CZ',
    'DK',
    'EE',
    'FI',
    'FR',
    'DE',
    'GR',
    'HU',
    'IE',
    'IT',
    'LV',
    'LT',
    'LU',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SK',
    'SI',
    'ES',
    'SE',
  ],
  northAmerica: ['US', 'CA'],
} as const;

export type ShippingRegionPreset = keyof typeof SHIPPING_REGION_PRESETS;
