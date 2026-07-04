// Country-first shipping selection for the in-app Market checkout (#948
// Option A). PURE half — no React, no I/O (coverage scope: src/utils); the
// relay fetch lives in services/marketShippingService, the UI in
// MarketCheckoutSheet + CountryPickerSheet.
//
// Gamma commerce models shipping as addressable kind-30406 "shipping option"
// events published by the merchant:
//
//   ["d", <id>]                     – addressable identifier
//   ["title", <name>]               – human label ("Royal Mail Tracked 48")
//   ["price", <amount>, <currency>] – base cost
//   ["country", <ISO-3166-1-a2>, …] – where it applies; ABSENT = worldwide
//
// A product (kind 30402) may reference options it supports via
//   ["shipping_option", "30406:<pubkey>:<d>", <extra-cost?>]
// where the optional third element is a product-specific surcharge in the
// option's own currency. The buyer's kind-16 type-1 order then carries
// ["shipping", "30406:<pubkey>:<d>"] so the merchant knows exactly what was
// chosen, and the order `amount` is the ALL-IN total (subtotal + shipping).
import { toAlpha2 } from '../data/countries';

export const SHIPPING_OPTION_KIND = 30406;

/** A parsed kind-30406 shipping option. */
export interface ShippingOption {
  /** Addressable coordinate — `30406:<pubkey>:<d>`. */
  coordinate: string;
  /** Merchant pubkey (hex) the event roots on. */
  pubkey: string;
  /** The `d` tag. */
  dTag: string;
  /** Human label; falls back to the `d` tag when the event has no title. */
  title: string;
  /** Base cost in `currency` units (0 when the event has no/invalid price). */
  baseAmount: number;
  /** Upper-cased price currency, e.g. 'GBP', 'USD', 'SATS', 'BTC'. */
  currency: string;
  /** Upper-cased ISO 3166-1 alpha-2 codes this option ships to. EMPTY = worldwide. */
  countries: string[];
  /** Event `created_at` — used to keep only the newest per `d` (addressable). */
  createdAt: number;
}

/** A product's `shipping_option` reference: which options it supports + surcharge. */
export interface ProductShippingRef {
  /** `30406:<pubkey>:<d>` coordinate of the referenced option. */
  coordinate: string;
  /** Product-specific extra cost in the OPTION's currency (absent = 0). */
  extraAmount?: number;
}

/** Minimal event shape the parser needs. */
export interface ShippingOptionEventInput {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
}

const num = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Parse a kind-30406 event into a {@link ShippingOption}, or null when it
 * isn't one (wrong kind / missing `d`). Country values are collected from
 * EVERY `country` tag (each may carry one or many values), upper-cased and
 * deduped; an event with no country tags ships worldwide (empty array).
 */
export function parseShippingOptionEvent(ev: ShippingOptionEventInput): ShippingOption | null {
  if (ev.kind !== SHIPPING_OPTION_KIND || !Array.isArray(ev.tags)) return null;
  const dTag = ev.tags.find((t) => t[0] === 'd')?.[1];
  if (typeof dTag !== 'string' || dTag.length === 0) return null;

  const title = ev.tags.find((t) => t[0] === 'title')?.[1];
  const priceTag = ev.tags.find((t) => t[0] === 'price');
  const baseAmount = num(priceTag?.[1]) ?? 0;
  const currency =
    typeof priceTag?.[2] === 'string' && priceTag[2].trim() ? priceTag[2].trim().toUpperCase() : '';

  // Normalise every value to alpha-2: merchants publish a mix of alpha-2 and
  // alpha-3 (Robotechy's live 30406s carry GBR/IRL/DEU…) — toAlpha2 maps known
  // alpha-3 → alpha-2 and upper-cases anything else, so matching is on
  // normalised codes rather than string luck.
  const countries = new Set<string>();
  for (const t of ev.tags) {
    if (t[0] !== 'country') continue;
    for (const v of t.slice(1)) {
      if (typeof v === 'string' && v.trim()) countries.add(toAlpha2(v));
    }
  }

  return {
    coordinate: `${SHIPPING_OPTION_KIND}:${ev.pubkey}:${dTag}`,
    pubkey: ev.pubkey,
    dTag,
    title: typeof title === 'string' && title.trim() ? title.trim() : dTag,
    baseAmount,
    currency,
    countries: [...countries],
    createdAt: ev.created_at,
  };
}

/**
 * Collapse a raw fetch result to the newest event per addressable
 * coordinate (`30406:<pubkey>:<d>`) — 30406 is addressable, so relays can
 * return several revisions of the same option. Keying on the full
 * coordinate (not the `d` tag alone) keeps it multi-merchant safe: two
 * sellers can publish the same `d` without colliding.
 */
export function dedupeNewestPerCoordinate(options: ShippingOption[]): ShippingOption[] {
  const byCoordinate = new Map<string, ShippingOption>();
  for (const o of options) {
    const prev = byCoordinate.get(o.coordinate);
    if (!prev || o.createdAt > prev.createdAt) byCoordinate.set(o.coordinate, o);
  }
  return [...byCoordinate.values()];
}

/**
 * The options compatible with a destination country (ISO 3166-1 alpha-2,
 * case-insensitive). An option with NO country restriction counts as
 * worldwide and always matches.
 */
export function filterShippingOptions(
  options: ShippingOption[],
  countryCode: string,
): ShippingOption[] {
  const code = countryCode.trim().toUpperCase();
  if (!code) return [];
  return options.filter((o) => o.countries.length === 0 || o.countries.includes(code));
}

/**
 * All-in cost of an option for a product, in the OPTION's currency:
 * the 30406 base price + the product's `shipping_option` surcharge.
 */
export function shippingCostFor(option: ShippingOption, ref?: ProductShippingRef): number {
  // The surcharge only applies when the ref actually points at THIS option —
  // a mismatched ref must not silently over/under-charge shipping.
  const applies = ref?.coordinate === option.coordinate;
  const extra =
    applies && Number.isFinite(ref?.extraAmount) && (ref?.extraAmount ?? 0) > 0
      ? ref!.extraAmount!
      : 0;
  return option.baseAmount + extra;
}

/**
 * Convert a shipping cost to whole sats. 'SATS'/'SAT' pass through, 'BTC'
 * scales by 1e8, and a fiat currency divides by the BTC spot price the caller
 * fetched for that currency (`fiatService.getBtcPrice`). Returns null when the
 * currency is fiat and no rate is available — callers must treat that as
 * "cannot price shipping" and block submission rather than guessing.
 */
export function shippingCostSats(
  amount: number,
  currency: string,
  btcPriceInCurrency: number | null,
): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cur = currency.trim().toUpperCase();
  if (cur === 'SATS' || cur === 'SAT') return Math.round(amount);
  if (cur === 'BTC') return Math.round(amount * 1e8);
  if (
    btcPriceInCurrency === null ||
    !Number.isFinite(btcPriceInCurrency) ||
    btcPriceInCurrency <= 0
  )
    return null;
  return Math.round((amount / btcPriceInCurrency) * 1e8);
}

/** All-in order amount: product subtotal + shipping, both already in sats. */
export function orderTotalWithShippingSats(subtotalSats: number, shippingSats: number): number {
  const sub = Number.isFinite(subtotalSats) && subtotalSats >= 0 ? subtotalSats : 0;
  const ship = Number.isFinite(shippingSats) && shippingSats >= 0 ? shippingSats : 0;
  return Math.round(sub + ship);
}
