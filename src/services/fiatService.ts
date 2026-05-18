const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let cachedRate: { currency: string; rate: number; timestamp: number } | null = null;

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

export async function getBtcPrice(currency: FiatCurrency): Promise<number | null> {
  if (
    cachedRate &&
    cachedRate.currency === currency &&
    Date.now() - cachedRate.timestamp < CACHE_DURATION
  ) {
    return cachedRate.rate;
  }

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currency.toLowerCase()}`,
    );
    const data = await response.json();
    const rate = data.bitcoin?.[currency.toLowerCase()];
    if (rate) {
      cachedRate = { currency, rate, timestamp: Date.now() };
      return rate;
    }
    return null;
  } catch (error) {
    console.warn('Failed to fetch BTC price:', error);
    return cachedRate?.currency === currency ? cachedRate.rate : null;
  }
}

export function satsToFiat(sats: number, btcPrice: number): number {
  return (sats / 100_000_000) * btcPrice;
}

export function formatFiat(amount: number, currency: FiatCurrency): string {
  if (amount > 0 && amount < 0.01) {
    const symbol = (0)
      .toLocaleString(undefined, { style: 'currency', currency })
      .replace(/[\d.,\s]/g, '');
    return `< ${symbol}0.01`;
  }
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Currency symbol prefix used by the no-rate placeholder. Reused by
// `currencySymbol()` below + the WalletCard's `£–` placeholder so the
// symbol stays consistent with what `formatFiat` produces.
export function currencySymbol(currency: FiatCurrency): string {
  // `formatToParts` would be the principled API, but on Hermes its
  // 'currency' part is reliably present only after Intl polyfills load.
  // The replace-everything-non-symbol trick is what the rest of the
  // file already uses (see `formatFiat`) and works on a cold Hermes JVM.
  return (0).toLocaleString(undefined, { style: 'currency', currency }).replace(/[\d.,\s]/g, '');
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
  // The em-dash (–) is intentional — cleaner typographically than
  // a hyphen-minus.
  if (btcPrice === null) return `${currencySymbol(currency)}–`;
  return formatFiat(satsToFiat(sats, btcPrice), currency);
}
