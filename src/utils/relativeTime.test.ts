import { relativeTime } from './relativeTime';

describe('relativeTime', () => {
  const NOW = 1_000_000_000; // fixed reference "now" in seconds

  it('shows "now" for anything under a minute (and for future stamps)', () => {
    expect(relativeTime(NOW, NOW)).toBe('now');
    expect(relativeTime(NOW - 30, NOW)).toBe('now');
    expect(relativeTime(NOW + 500, NOW)).toBe('now'); // future clamps to now
  });

  it('formats minutes, hours, days, weeks and years', () => {
    expect(relativeTime(NOW - 5 * 60, NOW)).toBe('5m');
    expect(relativeTime(NOW - 3 * 3600, NOW)).toBe('3h');
    expect(relativeTime(NOW - 2 * 86400, NOW)).toBe('2d');
    expect(relativeTime(NOW - 4 * 7 * 86400, NOW)).toBe('4w');
    expect(relativeTime(NOW - 2 * 365 * 86400, NOW)).toBe('2y');
  });

  it('guards against non-finite input', () => {
    expect(relativeTime(NaN, NOW)).toBe('now');
  });
});
