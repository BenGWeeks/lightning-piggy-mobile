import type { MarketPreferences } from '../services/marketStorage';
import { normalizeCurrencyCode } from './currencyCode';

export function validateMarketPreferences(
  preferences: MarketPreferences,
  options: { merchants: string[]; countries: string[]; currencies: string[] },
): MarketPreferences {
  // A selection saved before currencies were normalised (e.g. "SAT") maps onto
  // its canonical chip ("SATS") rather than being dropped.
  const currency = preferences.currency ? normalizeCurrencyCode(preferences.currency) : null;
  return {
    ...preferences,
    merchant:
      preferences.merchant && options.merchants.includes(preferences.merchant)
        ? preferences.merchant
        : null,
    country:
      preferences.country && options.countries.includes(preferences.country)
        ? preferences.country
        : null,
    currency: currency && options.currencies.includes(currency) ? currency : null,
  };
}
