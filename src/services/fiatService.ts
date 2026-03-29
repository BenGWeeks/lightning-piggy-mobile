const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let cachedRate: { currency: string; rate: number; timestamp: number } | null = null;

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'ZAR'] as const;
export type FiatCurrency = (typeof CURRENCIES)[number];

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
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function satsToFiatString(
  sats: number,
  btcPrice: number | null,
  currency: FiatCurrency,
): string {
  if (btcPrice === null) return '';
  return formatFiat(satsToFiat(sats, btcPrice), currency);
}
