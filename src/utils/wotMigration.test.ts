import { deriveInitialWotTier } from './wotMigration';

describe('deriveInitialWotTier', () => {
  it('maps followingOnly=true → friends regardless of secretMode', () => {
    expect(deriveInitialWotTier({ followingOnly: true, secretMode: false })).toBe('friends');
    expect(deriveInitialWotTier({ followingOnly: true, secretMode: true })).toBe('friends');
  });

  it('maps followingOnly=false + secretMode=true → all (preserves the dev escape hatch)', () => {
    expect(deriveInitialWotTier({ followingOnly: false, secretMode: true })).toBe('all');
  });

  it('maps followingOnly=false + secretMode=false → friends (production hard-lock)', () => {
    expect(deriveInitialWotTier({ followingOnly: false, secretMode: false })).toBe('friends');
  });

  it('maps missing legacy state (cold install) → friends', () => {
    expect(deriveInitialWotTier({ followingOnly: null, secretMode: false })).toBe('friends');
    expect(deriveInitialWotTier({ followingOnly: null, secretMode: true })).toBe('friends');
  });
});
