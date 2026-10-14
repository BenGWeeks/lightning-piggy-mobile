import { validateMarketPreferences } from './marketPreferences';

const base = {
  mode: 'wotFriends' as const,
  merchant: 'Shop',
  shipsTo: 'GB',
  includeUnknownShipping: false,
  currency: 'GBP',
};

it('restores known axes and falls back to All for unknown values', () => {
  expect(validateMarketPreferences(base, { merchants: ['Shop'], currencies: ['GBP'] })).toEqual(
    base,
  );
  expect(validateMarketPreferences(base, { merchants: ['Other'], currencies: ['USD'] })).toEqual({
    ...base,
    merchant: null,
    currency: null,
  });
});

it('keeps a Ships-to destination even when no loaded listing ships there', () => {
  // The destination is the shopper's, not the catalogue's: its chip stays
  // visible (see shipsToOptions) so it can be cleared.
  expect(validateMarketPreferences(base, { merchants: [], currencies: [] }).shipsTo).toBe('GB');
});

it('drops a Ships-to value that is not an ISO country code (legacy vendor names)', () => {
  expect(
    validateMarketPreferences(
      { ...base, shipsTo: 'United Kingdom' },
      { merchants: [], currencies: [] },
    ).shipsTo,
  ).toBeNull();
});

it('maps a legacy sats spelling onto the canonical SATS chip', () => {
  const saved = { ...base, merchant: null, shipsTo: null, currency: 'SAT' };
  expect(validateMarketPreferences(saved, { merchants: [], currencies: ['SATS'] })).toEqual({
    ...saved,
    currency: 'SATS',
  });
});
