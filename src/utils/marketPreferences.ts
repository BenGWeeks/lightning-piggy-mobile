import type { MarketPreferences } from '../services/marketStorage';
import { normalizeCurrencyCode } from './currencyCode';
import { normalizeShipsToSelection } from './marketShipsTo';

export function validateMarketPreferences(
  preferences: MarketPreferences,
  options: { merchants: string[]; currencies: string[] },
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
    // Ships-to is the shopper's destination, not a property of the catalogue:
    // it survives a catalogue with no listings for it (the chip stays shown so
    // it can be cleared) and only has to be a real country code.
    shipsTo: normalizeShipsToSelection(preferences.shipsTo),
    currency: currency && options.currencies.includes(currency) ? currency : null,
  };
}
