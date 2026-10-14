import { validateMarketPreferences } from './marketPreferences';
it('restores known axes and falls back to All for unknown values', () => {
  const saved = { mode: 'wotFriends' as const, merchant: 'Shop', country: 'UK', currency: 'GBP' };
  expect(
    validateMarketPreferences(saved, {
      merchants: ['Shop'],
      countries: ['UK'],
      currencies: ['GBP'],
    }),
  ).toEqual(saved);
  expect(
    validateMarketPreferences(saved, {
      merchants: ['Other'],
      countries: ['US'],
      currencies: ['USD'],
    }),
  ).toEqual({ mode: 'wotFriends', merchant: null, country: null, currency: null });
});

it('maps a legacy sats spelling onto the canonical SATS chip', () => {
  const saved = { mode: 'preferred' as const, merchant: null, country: null, currency: 'SAT' };
  expect(
    validateMarketPreferences(saved, { merchants: [], countries: [], currencies: ['SATS'] }),
  ).toEqual({ ...saved, currency: 'SATS' });
});
