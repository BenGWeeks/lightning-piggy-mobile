// Where a Market listing ships to, derived ONLY from what its seller publishes
// on Nostr (Gamma Markets spec, github.com/GammaMarkets/market-spec). PURE —
// no React, no I/O; the batched relay fetch lives in
// services/marketShippingCache and the screen wiring in hooks/useMarketShipsTo.
//
//   • A product (kind 30402) references the shipping options it supports with
//     ["shipping_option", "30406:<pubkey>:<d>", <extra-cost?>]
//     (parsed by `listingShippingRefs`).
//   • Each kind-30406 option lists the ISO 3166-1 alpha-2 codes it ships to in
//     its `country` tag, optionally narrowed by ISO 3166-2 `region` codes
//     (parsed by `parseShippingOptionEvent`). An option with no country
//     restriction ships worldwide.
//   • ["type", <simple|variable|variation>, "digital"] needs no shipping.
//
// No hard-coded locations: curated catalogue products and listings whose
// shipping can't be resolved from Nostr data are `unknown`, never guessed from
// the vendor directory.
import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { isKnownCountry, toAlpha2 } from '../data/countries';
import { listingShippingRefs } from './marketListingShipping';
import type { ShippingOption } from './marketShipping';

/** A listing's shipping reach, as far as its published data says. */
export type ShipsTo =
  /** Digital goods, or a referenced option with no country restriction. */
  | { kind: 'anywhere'; reason: 'digital' | 'worldwide' }
  /** The union of the referenced options' countries (alpha-2, sorted). */
  | { kind: 'countries'; countries: readonly string[] }
  /** Referenced options are still being fetched. */
  | { kind: 'pending' }
  /** No usable shipping data: ask the seller. */
  | { kind: 'unknown' };

/**
 * Looks up a fetched shipping option by coordinate: the option, `null` when
 * the fetch finished without finding it (or failed), `undefined` while it
 * hasn't been fetched yet.
 */
export type ShippingOptionLookup = (coordinate: string) => ShippingOption | null | undefined;

export const SHIPS_TO_UNKNOWN: ShipsTo = { kind: 'unknown' };
const SHIPS_TO_PENDING: ShipsTo = { kind: 'pending' };
const SHIPS_TO_DIGITAL: ShipsTo = { kind: 'anywhere', reason: 'digital' };
const SHIPS_TO_WORLDWIDE: ShipsTo = { kind: 'anywhere', reason: 'worldwide' };

/**
 * Whether a listing declares itself digital (`["type", <type>, "digital"]`).
 *
 * The spec defaults a missing `type` tag to digital, but kind 30402 is shared
 * with NIP-99 classifieds, which predate Gamma and never carry `type` — so a
 * missing tag is NOT read as digital here; otherwise a local-pickup classified
 * would claim to reach every country.
 */
export function isDigitalListing(event: Pick<Event, 'kind' | 'tags'>): boolean {
  if (event.kind !== 30402) return false;
  const format = event.tags.find((t) => t[0] === 'type')?.[2];
  return typeof format === 'string' && format.trim().toLowerCase() === 'digital';
}

/** Every distinct 30406 coordinate the products' listings reference — the
 * batch the shipping fetch resolves (curated products contribute none). */
export function shippingCoordinatesOf(products: readonly MarketProduct[]): string[] {
  const coordinates = new Set<string>();
  for (const product of products) {
    const event = product.listing?.event;
    if (!event || isDigitalListing(event)) continue;
    for (const ref of listingShippingRefs(event)) coordinates.add(ref.coordinate);
  }
  return [...coordinates];
}

/**
 * Where a relay listing ships to. Digital listings reach everywhere. Otherwise
 * it's the union of the referenced options that resolved: any worldwide option
 * makes the listing worldwide; none resolved (no refs, or every ref missing)
 * is `unknown`; refs still in flight are `pending`.
 */
export function listingShipsTo(
  event: Pick<Event, 'kind' | 'tags'>,
  lookup: ShippingOptionLookup,
): ShipsTo {
  if (isDigitalListing(event)) return SHIPS_TO_DIGITAL;
  const countries = new Set<string>();
  let pending = false;
  for (const ref of listingShippingRefs(event)) {
    const option = lookup(ref.coordinate);
    if (option === undefined) {
      pending = true;
      continue;
    }
    if (option === null) continue;
    if (option.countries.length === 0) return SHIPS_TO_WORLDWIDE;
    for (const code of option.countries) countries.add(code);
  }
  // A partial answer is still an answer for the countries it names, but don't
  // call a listing `unknown` while some of its options are still loading.
  if (countries.size > 0) return { kind: 'countries', countries: [...countries].sort() };
  return pending ? SHIPS_TO_PENDING : SHIPS_TO_UNKNOWN;
}

/** Ships-to for any Market product; curated (non-Nostr) products are unknown. */
export function productShipsTo(product: MarketProduct, lookup: ShippingOptionLookup): ShipsTo {
  return product.listing ? listingShipsTo(product.listing.event, lookup) : SHIPS_TO_UNKNOWN;
}

/** Shipping data that can't place the listing (pending or unknown). */
export function isShipsToUnresolved(shipsTo: ShipsTo): boolean {
  return shipsTo.kind === 'pending' || shipsTo.kind === 'unknown';
}

/**
 * Whether a listing passes the Ships-to filter. `country` null = Anywhere
 * (everything passes). Otherwise worldwide/digital listings and those naming
 * the country pass; listings without resolvable shipping data pass only while
 * `includeUnknown` is on.
 */
export function shipsToMatches(
  shipsTo: ShipsTo,
  country: string | null,
  includeUnknown: boolean,
): boolean {
  if (country === null) return true;
  switch (shipsTo.kind) {
    case 'anywhere':
      return true;
    case 'countries':
      return shipsTo.countries.includes(country);
    default:
      return includeUnknown;
  }
}

/**
 * The Ships-to chip codes: every country named by the loaded listings'
 * shipping data, sorted by display name, with the phone's region country
 * first when present. A saved selection no longer in the data is kept (after
 * the device country) so its chip can still be seen and cleared.
 */
export function shipsToOptions(
  shipsTos: Iterable<ShipsTo>,
  options: {
    deviceCountry: string | null;
    selected: string | null;
    nameOf: (code: string) => string;
    locale?: string;
  },
): string[] {
  const codes = new Set<string>();
  for (const shipsTo of shipsTos) {
    if (shipsTo.kind === 'countries') for (const code of shipsTo.countries) codes.add(code);
  }
  const lead: string[] = [];
  const { deviceCountry, selected } = options;
  if (deviceCountry && codes.delete(deviceCountry)) lead.push(deviceCountry);
  if (selected && !lead.includes(selected) && !codes.has(selected)) lead.push(selected);
  const rest = [...codes]
    .map((code) => ({ code, name: options.nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, options.locale) || a.code.localeCompare(b.code))
    .map((entry) => entry.code);
  return [...lead, ...rest];
}

/**
 * Normalise a stored Ships-to selection: a known ISO 3166-1 country (alpha-2
 * or alpha-3, any case) becomes its alpha-2 code; anything else — including
 * the retired Country filter's vendor-name values like "United Kingdom" when
 * they arrive here — is `null` (Anywhere).
 */
export function normalizeShipsToSelection(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^[A-Za-z]{2,3}$/.test(raw.trim())) return null;
  const code = toAlpha2(raw);
  return isKnownCountry(code) ? code : null;
}
