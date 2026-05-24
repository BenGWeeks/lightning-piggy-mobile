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

  it('maps missing legacy state (cold install) → all — matches wotSettingsService.DEFAULTS', () => {
    // PR #630: the null case used to return 'friends', but that path
    // ran inside GroupsContext's migration on first login and persisted
    // 'friends' to storage — silently overriding the DEFAULTS = 'all'
    // upgrade #627 introduced. Cold install now maps to 'all' so
    // wotSettingsService stays the single source of truth for the
    // first-run default. SecretMode is irrelevant when there's no
    // legacy value at all.
    expect(deriveInitialWotTier({ followingOnly: null, secretMode: false })).toBe('all');
    expect(deriveInitialWotTier({ followingOnly: null, secretMode: true })).toBe('all');
  });
});
