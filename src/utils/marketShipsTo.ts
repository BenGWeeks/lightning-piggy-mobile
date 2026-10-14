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
  | {
      kind: 'countries';
      countries: readonly string[];
      /** Countries from options naming fewer than 50 destinations, for quick chips only. */
      quickChipCountries?: readonly string[];
    }
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
const WORLDWIDE_CHIP_THRESHOLD = 50;
const MAX_EXTRA_CHIPS = 6;
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
  const quickChipCountries = new Set<string>();
  let hasBroadOption = false;
  let pending = false;
  for (const ref of listingShippingRefs(event)) {
    const option = lookup(ref.coordinate);
    if (option === undefined) {
      pending = true;
      continue;
    }
    if (option === null) continue;
    if (option.countries.length === 0) return SHIPS_TO_WORLDWIDE;
    const broad = option.countries.length >= WORLDWIDE_CHIP_THRESHOLD;
    hasBroadOption ||= broad;
    for (const code of option.countries) {
      countries.add(code);
      if (!broad) quickChipCountries.add(code);
    }
  }
  // A partial answer is still an answer for the countries it names, but don't
  // call a listing `unknown` while some of its options are still loading.
  if (countries.size > 0) {
    return {
      kind: 'countries',
      countries: [...countries].sort(),
      ...(hasBroadOption || countries.size >= WORLDWIDE_CHIP_THRESHOLD
        ? { quickChipCountries: [...quickChipCountries].sort() }
        : {}),
    };
  }
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
 * Quick country chips: phone region, then the saved selection, then at most
 * six destinations ranked by listing count and localised name. Broad shipping
 * options don't contribute candidates; matching still uses their full reach.
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
  const counts = new Map<string, number>();
  for (const shipsTo of shipsTos) {
    if (shipsTo.kind !== 'countries') continue;
    const candidates =
      shipsTo.quickChipCountries ??
      (shipsTo.countries.length < WORLDWIDE_CHIP_THRESHOLD ? shipsTo.countries : []);
    for (const code of new Set(candidates)) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const lead: string[] = [];
  const { deviceCountry, selected } = options;
  if (deviceCountry) lead.push(deviceCountry);
  if (selected && !lead.includes(selected)) lead.push(selected);
  for (const code of lead) counts.delete(code);
  const rest = [...counts]
    .map(([code, count]) => ({ code, count, name: options.nameOf(code) }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name, options.locale) ||
        a.code.localeCompare(b.code),
    )
    .slice(0, MAX_EXTRA_CHIPS)
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
