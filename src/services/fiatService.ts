const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
// A pending CoinGecko request must never hang a caller: checkout's rate
// effect awaits every currency together, so one stuck socket would block
// order placement (and its bounded retry) indefinitely.
const FETCH_TIMEOUT_MS = 8000;

// Keyed by currency: checkout can price shipping in several currencies within
// one 5-minute window, and a single slot would evict each one's fresh rate
// (and its stale fallback) as soon as another currency was fetched.
const cachedRates = new Map<string, { rate: number; timestamp: number }>();

// Curated fiat list intersected with CoinGecko's `simple/supported_vs_currencies`
// endpoint. Verified 2026-05-07: every code below is present in the CoinGecko
// response. Order is the display order in the picker — USD/EUR/GBP first
// because they're the global majors, then alphabetical for the rest.
// Stablecoins and crypto vs-currencies (BTC/ETH/sats/etc) are intentionally
// omitted: this is the user's *display* fiat for sats↔fiat conversion.
export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCY_LIST: readonly CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
] as const;

// Backward-compatible export: previously a literal tuple of 8 codes. Derived
// from CURRENCY_LIST so callers (DisplayScreen, WalletContext migration check)
// keep working. Type widens from a literal tuple to `string[]`, which matches
// every existing consumer (storage compares as string).
export const CURRENCIES: readonly string[] = CURRENCY_LIST.map((c) => c.code);

// Kept loose (`string`) instead of a tuple-derived literal union: with 38
// entries the literal union slows TypeScript checks materially and offers
// no runtime benefit — getBtcPrice already null-checks the response.
export type FiatCurrency = string;

/**
 * BTC spot price in `currency`. A rate fetched within the last 5 minutes is
 * served from cache; otherwise CoinGecko is queried.
 *
 * `allowStale` (default true — the display path) lets a network failure fall
 * back to the last known same-currency rate of ANY age, which is fine for a
 * balance caption but not for money: pass `false` where the rate prices a
 * payable amount (Market checkout shipping), so an outage yields `null` and
 * the caller blocks rather than signing an order at an expired rate.
 */
export async function getBtcPrice(
  currency: FiatCurrency,
  opts: { allowStale?: boolean } = {},
): Promise<number | null> {
  const allowStale = opts.allowStale ?? true;
  const cached = cachedRates.get(currency);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.rate;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currency.toLowerCase()}`,
      { signal: controller.signal },
    );
    const data = await response.json();
    const rate = data.bitcoin?.[currency.toLowerCase()];
    if (rate) {
      cachedRates.set(currency, { rate, timestamp: Date.now() });
      return rate;
    }
    return null;
  } catch (error) {
    console.warn('Failed to fetch BTC price:', error);
    return allowStale && cached ? cached.rate : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: drop the module-level rate cache. */
export function __resetBtcPriceCacheForTests(): void {
  cachedRates.clear();
}

export function satsToFiat(sats: number, btcPrice: number): number {
  return (sats / 100_000_000) * btcPrice;
}

export function formatFiat(amount: number, currency: FiatCurrency): string {
  if (amount > 0 && amount < 0.01) {
    return `< ${currencySymbol(currency)}0.01`;
  }
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Currency symbol prefix used by the no-rate placeholder. Reads from
// the curated `CURRENCY_LIST` (e.g. `A$`, `R$`, `د.إ`, `CHF`, `kr`) so
// the placeholder always matches what the picker shows the user for
// that currency — the `Intl.NumberFormat`-strip trick we considered
// earlier produced different results across ICU builds (Hermes vs
// React Native's bundled ICU can render `AUD` as `A$0.00` or just
// `$0.00`, and codes like `CHF`/`SEK` sometimes come back as the ISO
// code rather than a symbol). The list is authoritative; fall back to
// the ISO code itself if a caller passes a currency we don't know.
export function currencySymbol(currency: FiatCurrency): string {
  return CURRENCY_LIST.find((c) => c.code === currency)?.symbol ?? currency;
}

export function satsToFiatString(
  sats: number,
  btcPrice: number | null,
  currency: FiatCurrency,
): string {
  // When the BTC price isn't known (cold-start offline, mid-fetch,
  // upstream API hiccup) we used to return an empty string and let
  // callers hide the fiat row entirely. That made the user wonder if
  // something was broken (#633). A `£–` / `$–` / `€–` placeholder is
  // honest: we know your currency, we just don't have a rate right now.
  // The character is U+2013 (EN DASH) — typographically the right
  // glyph for a "blank value" placeholder (a full em-dash would feel
  // visually too wide next to a one-character currency symbol).
  if (btcPrice === null) return `${currencySymbol(currency)}–`;
  return formatFiat(satsToFiat(sats, btcPrice), currency);
}
