// Market price display: the listing's own price (primary line) and its
// conversion into the user's display currency (the "≈" secondary line).
// Pure — no React, no I/O. Rates come in from the caller: the wallet's shared
// BTC price for the user's currency, plus (only for fiat listings in a
// different currency) the listing currency's BTC price.
import type { MarketProduct } from '../data/marketProducts';
import { CURRENCIES, formatFiat, satsToFiat } from '../services/fiatService';
import { normalizeCurrencyCode, SATS_CURRENCY_CODE } from './currencyCode';

/** A listing's price in its own unit, normalised for display. */
export interface MarketPriceValue {
  /** Amount in the listing's own unit, or null when the listing didn't carry
   * a numeric amount (display then falls back to `label`). */
  amount: number | null;
  /** Normalised currency code (`SATS`, `BTC`, `GBP`, `MSAT`, …). */
  currency: string;
  /** Exact sats when the price is sats/BTC-denominated, else null. */
  sats: number | null;
  /** Billing-period suffix such as `/month`, or `''`. */
  recurrence: string;
  /** The parser's raw label — the fallback when `amount` is missing. */
  label: string;
}

/** The converted ("≈") line: user fiat, sats, or both. Null = no line. */
export interface ConvertedPrice {
  fiat: string | null;
  sats: number | null;
}

export interface MarketPriceRates {
  /** The user's display currency (wallet setting), e.g. `GBP`. */
  userCurrency: string;
  /** BTC spot price in `userCurrency` (wallet's shared rate), if loaded. */
  userBtcPrice: number | null;
  /** BTC spot price in the listing's currency — only needed (and only
   * fetched) for fiat listings in a currency other than `userCurrency`. */
  listingBtcPrice: number | null;
}

const CONVERTIBLE_FIATS = new Set(CURRENCIES);

/** Read a product's price. Curated products (no signed listing) are priced
 * in sats. */
export function marketPriceOf(
  product: Pick<MarketProduct, 'listing' | 'priceSats'>,
): MarketPriceValue {
  const listing = product.listing;
  if (!listing) {
    return {
      amount: product.priceSats,
      currency: SATS_CURRENCY_CODE,
      sats: product.priceSats,
      recurrence: '',
      label: '',
    };
  }
  const currency = normalizeCurrencyCode(listing.currency ?? '');
  const amount =
    typeof listing.amount === 'number' && Number.isFinite(listing.amount) ? listing.amount : null;
  const satsDenominated = currency === SATS_CURRENCY_CODE || currency === 'BTC';
  return {
    amount,
    currency,
    sats: satsDenominated && amount !== null ? product.priceSats : null,
    recurrence: listing.recurrence ?? '',
    label: listing.priceLabel,
  };
}

/** Whole sats with locale thousands separators (`500000` → `500,000`). */
export function formatSatsNumber(sats: number, locale?: string): string {
  return Math.round(sats).toLocaleString(locale);
}

/** A fiat amount via the locale currency formatter (`£60.00`); unknown or
 * malformed codes fall back to `60.00 XYZ` rather than throwing. */
function formatListingFiat(amount: number, currency: string, locale?: string): string {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return formatFiat(amount, currency, locale);
    } catch {
      // Intl rejected the code — fall through to the plain form.
    }
  }
  return `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * The primary line: the listing's own price, properly formatted.
 * `satsLabel` renders a sats amount in the app's wording (the caller passes
 * the `market.sats` translation, e.g. `n => "500,000 sats"`).
 */
export function formatPrimaryPrice(
  price: MarketPriceValue,
  satsLabel: (formattedSats: string) => string,
  locale?: string,
): string {
  const { amount, currency, recurrence } = price;
  if (amount === null) return price.label;
  let text: string;
  if (currency === SATS_CURRENCY_CODE) {
    text = satsLabel(formatSatsNumber(amount, locale));
  } else if (currency === 'BTC') {
    text = `${amount.toLocaleString(locale, { maximumFractionDigits: 8 })} BTC`;
  } else if (/^[A-Z]{3}$/.test(currency)) {
    text = formatListingFiat(amount, currency, locale);
  } else {
    // msat and other non-ISO units: show as-is, just locale-grouped.
    text = `${amount.toLocaleString(locale, { maximumFractionDigits: 8 })} ${currency}`;
  }
  return text + recurrence;
}

/**
 * The listing currency whose BTC rate must be fetched separately, or null.
 * Only fiat listings in a convertible currency other than the user's need
 * one — sats/BTC listings and same-currency listings use the wallet's rate.
 */
export function listingRateCurrency(price: MarketPriceValue, userCurrency: string): string | null {
  if (price.sats !== null || price.amount === null || !(price.amount > 0)) return null;
  if (!CONVERTIBLE_FIATS.has(price.currency) || price.currency === userCurrency) return null;
  return price.currency;
}

/**
 * The "≈" line's content, or null when there's nothing to show (no rate
 * loaded yet, zero price, or a unit we can't convert such as msat):
 * - sats/BTC listing → user fiat
 * - fiat listing in the user's currency → sats
 * - fiat listing in another currency → user fiat + sats (sats alone if the
 *   user-currency rate isn't loaded)
 */
export function convertedPrice(
  price: MarketPriceValue,
  rates: MarketPriceRates,
  locale?: string,
): ConvertedPrice | null {
  if (price.amount === null || !(price.amount > 0)) return null;
  const { userCurrency, userBtcPrice } = rates;
  if (price.sats !== null) {
    if (!userBtcPrice) return null;
    return {
      fiat: formatFiat(satsToFiat(price.sats, userBtcPrice), userCurrency, locale),
      sats: null,
    };
  }
  if (!CONVERTIBLE_FIATS.has(price.currency)) return null;
  const sameCurrency = price.currency === userCurrency;
  const listingRate = sameCurrency ? userBtcPrice : rates.listingBtcPrice;
  if (!listingRate) return null;
  const sats = Math.round((price.amount / listingRate) * 1e8);
  if (sameCurrency) return { fiat: null, sats };
  const fiat = userBtcPrice
    ? formatFiat((price.amount / listingRate) * userBtcPrice, userCurrency, locale)
    : null;
  return { fiat, sats };
}
