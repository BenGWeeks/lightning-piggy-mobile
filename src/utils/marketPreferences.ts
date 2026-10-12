import type { MarketPreferences } from '../services/marketStorage';

export function validateMarketPreferences(
  preferences: MarketPreferences,
  options: { merchants: string[]; countries: string[]; currencies: string[] },
): MarketPreferences {
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
    currency:
      preferences.currency && options.currencies.includes(preferences.currency)
        ? preferences.currency
        : null,
  };
}
