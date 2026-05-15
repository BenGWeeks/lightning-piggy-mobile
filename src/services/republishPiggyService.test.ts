import { computeNextExpiresAt } from './republishPiggyService';
import type { HiddenPiggy } from './piggyStorageService';

const basePiggy = (over: Partial<HiddenPiggy> = {}): HiddenPiggy => ({
  id: 'piggy-1',
  lnurlw: 'lnurl1xyz',
  createdAt: 1_700_000_000,
  isPublic: true,
  ...over,
});

const YEAR = 365 * 24 * 60 * 60;
const NOW = 1_800_000_000;

describe('computeNextExpiresAt', () => {
  it('preserves the original window when expiresAt is known', () => {
    const thirtyDays = 30 * 24 * 60 * 60;
    const piggy = basePiggy({ expiresAt: basePiggy().createdAt + thirtyDays });
    expect(computeNextExpiresAt(piggy, NOW)).toBe(NOW + thirtyDays);
  });

  it('falls back to one year when expiresAt is missing', () => {
    const piggy = basePiggy();
    expect(computeNextExpiresAt(piggy, NOW)).toBe(NOW + YEAR);
  });

  it('falls back to one year when expiresAt is non-monotonic vs createdAt', () => {
    // Defensive: a corrupt record with expiresAt < createdAt shouldn't
    // produce a negative window. Treat as missing.
    const piggy = basePiggy({ expiresAt: basePiggy().createdAt - 100 });
    expect(computeNextExpiresAt(piggy, NOW)).toBe(NOW + YEAR);
  });

  it('always anchors to nowSec, never to the stale createdAt', () => {
    const sixMonths = 182 * 24 * 60 * 60;
    const piggy = basePiggy({ expiresAt: basePiggy().createdAt + sixMonths });
    // Re-running republish a year later still gives a window starting now,
    // not from the original createdAt.
    const later = NOW + 30 * 24 * 60 * 60;
    expect(computeNextExpiresAt(piggy, later)).toBe(later + sixMonths);
  });
});
