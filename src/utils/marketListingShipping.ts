// Shopper-side shipping quote for a relay listing (#1273). PURE.
//
// Gamma Markets: a product references the shipping options (kind 30406) it
// supports with ["shipping_option", "30406:<pubkey>:<d>", <extra-cost?>],
// and the extra cost is in the PRODUCT's currency. The all-in shipping price
// is therefore only a single number when the option and the product share a
// currency (or there is no surcharge); otherwise both parts are shown.
import type { Event } from 'nostr-tools';
import type { ShippingOption } from './marketShipping';

export interface ListingShippingRef {
  coordinate: string;
  /** Surcharge in the listing's currency; 0 when absent or malformed. */
  extraAmount: number;
}

export interface ListingShippingQuote {
  option: ShippingOption;
  /** Option base cost, in `option.currency`. */
  baseAmount: number;
  /** Surcharge in the listing currency. */
  extraAmount: number;
  /** base + extra when they're in the same currency (or extra is 0), else null. */
  totalAmount: number | null;
  /** Currency of `totalAmount` (the option's). */
  currency: string;
}

const sameCurrency = (a: string, b: string) => {
  const norm = (c: string) => (c.toUpperCase() === 'SAT' ? 'SATS' : c.toUpperCase());
  return norm(a) === norm(b);
};

/** The listing's direct 30406 shipping references (collection refs are not
 * expanded — the Market reader doesn't fetch collections). */
export function listingShippingRefs(event: Pick<Event, 'tags'>): ListingShippingRef[] {
  const refs: ListingShippingRef[] = [];
  for (const t of event.tags) {
    if (t[0] !== 'shipping_option' || !/^30406:[0-9a-f]{64}:.+/.test(t[1] ?? '')) continue;
    if (refs.some((r) => r.coordinate === t[1])) continue;
    const extra = Number(t[2]);
    refs.push({ coordinate: t[1], extraAmount: Number.isFinite(extra) && extra > 0 ? extra : 0 });
  }
  return refs;
}

/** Quotes for the referenced options that the seller actually publishes. */
export function quoteListingShipping(
  listingCurrency: string,
  refs: readonly ListingShippingRef[],
  options: readonly ShippingOption[],
): ListingShippingQuote[] {
  const quotes: ListingShippingQuote[] = [];
  for (const ref of refs) {
    const option = options.find((o) => o.coordinate === ref.coordinate);
    if (!option) continue;
    const combinable = ref.extraAmount === 0 || sameCurrency(option.currency, listingCurrency);
    quotes.push({
      option,
      baseAmount: option.baseAmount,
      extraAmount: ref.extraAmount,
      totalAmount: combinable ? roundMoney(option.baseAmount + ref.extraAmount) : null,
      currency: option.currency,
    });
  }
  return quotes;
}

/** Strip binary float noise (2.1 + 1.2 → 3.3, not 3.3000000000000003). */
function roundMoney(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/** Listing `stock` as a non-negative integer, or null when not tracked. */
export function listingStock(event: Pick<Event, 'tags'>): number | null {
  const raw = event.tags.find((t) => t[0] === 'stock')?.[1];
  if (raw === undefined || !/^\d{1,9}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** Listing categories (`t` tags), de-duplicated, at most `max`. */
export function listingCategories(event: Pick<Event, 'tags'>, max = 10): string[] {
  const out: string[] = [];
  for (const t of event.tags) {
    const value = t[0] === 't' ? t[1]?.trim() : '';
    if (value && value.length <= 40 && !out.includes(value)) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** Display an amount in its currency's usual precision: whole sats, two
 * decimals for fiat (3.5 GBP → "3.50"), up to 8 for BTC. */
export function formatMarketAmount(amount: number, currency: string): string {
  const cur = currency.toUpperCase();
  if (cur === 'SATS' || cur === 'SAT') return String(Math.round(amount));
  if (cur === 'BTC') return String(Number(amount.toFixed(8)));
  return amount.toFixed(2);
}
