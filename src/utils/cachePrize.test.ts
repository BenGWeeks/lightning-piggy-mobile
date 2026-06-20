import { hasPrize } from './cachePrize';

describe('hasPrize', () => {
  it('is true for an LP Piggy with a payout', () => {
    expect(hasPrize({ isLpPiggy: true, payoutSats: 1000 })).toBe(true);
  });

  it('is true even when the payout is zero (a known, advertised amount)', () => {
    // `payoutSats != null` is the gate, mirroring LpPayoutBadge — a 0-sat
    // advertised payout is still a known payout, not "no prize info".
    expect(hasPrize({ isLpPiggy: true, payoutSats: 0 })).toBe(true);
  });

  it('is false for an LP Piggy with no payout advertised', () => {
    expect(hasPrize({ isLpPiggy: true, payoutSats: null })).toBe(false);
    expect(hasPrize({ isLpPiggy: true, payoutSats: undefined })).toBe(false);
  });

  it('is false for a vanilla NIP-GC cache even if a payout is present', () => {
    expect(hasPrize({ isLpPiggy: false, payoutSats: 1000 })).toBe(false);
  });

  it('is false for a vanilla cache with no payout', () => {
    expect(hasPrize({ isLpPiggy: false, payoutSats: null })).toBe(false);
  });
});
