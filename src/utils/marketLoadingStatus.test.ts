import { marketLoadingStatus } from './marketLoadingStatus';

describe.each(['preferred', 'wotFriends'] as const)('%s scope', (mode) => {
  it('shows full loading only without listings', () => {
    expect(marketLoadingStatus(true, false, 0, mode)).toBe('market.live.loading');
    expect(marketLoadingStatus(true, false, 12, mode)).toBe('market.live.updating');
    expect(marketLoadingStatus(true, true, 12, mode)).toBe('market.live.updating');
  });

  it.each([
    [false, 0],
    [false, 12],
    [true, 12],
  ] as const)('uses the scope loaded label (incomplete=%s, count=%s)', (incomplete, count) => {
    expect(marketLoadingStatus(false, incomplete, count, mode)).toBe(
      mode === 'preferred' ? 'market.live.loadedPreferred' : 'market.live.loaded',
    );
  });
});
