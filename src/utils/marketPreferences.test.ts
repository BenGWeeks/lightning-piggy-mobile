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
