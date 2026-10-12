import { marketLoadingStatus } from './marketLoadingStatus';
it('shows full loading only without listings and clears it after the first page', () => {
  expect(marketLoadingStatus(true, false, 0)).toBe('market.live.loading');
  expect(marketLoadingStatus(true, false, 12)).toBe('market.live.loaded');
  expect(marketLoadingStatus(false, false, 0)).toBe('market.live.loaded');
  expect(marketLoadingStatus(false, true, 12)).toBe('market.live.incomplete');
});
