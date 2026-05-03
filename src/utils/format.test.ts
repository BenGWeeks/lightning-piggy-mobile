/**
 * Unit coverage for the small string / date formatters used by the
 * Messages list and contact rows. Pure functions, deterministic — no
 * timer / locale plumbing required beyond an injected `now` for the
 * relative date helper.
 */

import { formatFriendlyDateTime, truncateMiddle } from './format';

describe('truncateMiddle', () => {
  it('returns empty string for falsy input', () => {
    expect(truncateMiddle('')).toBe('');
  });

  it('returns the original string when shorter than head + tail + 1', () => {
    // 'abcde' is 5 chars, defaults are head=6 tail=6 so head+tail+1 = 13.
    expect(truncateMiddle('abcde')).toBe('abcde');
  });

  it('elides the middle with the unicode ellipsis', () => {
    const long = 'npub1' + 'x'.repeat(60) + 'tail99';
    const out = truncateMiddle(long);
    expect(out.startsWith('npub1x')).toBe(true);
    expect(out.endsWith('tail99')).toBe(true);
    expect(out).toContain('…');
  });

  it('respects a custom head/tail length', () => {
    const out = truncateMiddle('abcdefghijklmnopqrstuvwxyz', 3, 4);
    expect(out).toBe('abc…wxyz');
  });
});

describe('formatFriendlyDateTime', () => {
  // Build the "now" reference via local-time setters so the calendar
  // day comparisons inside formatFriendlyDateTime (which use
  // `getFullYear/getMonth/getDate` — i.e. *local* dates) are stable
  // regardless of the host TZ. Using a fixed UTC string here would
  // shift to a different local calendar day on hosts like UTC-10 /
  // UTC+14, breaking the Today / Yesterday assertions.
  const NOW = new Date();
  NOW.setFullYear(2026, 4 /* May */, 3);
  NOW.setHours(12, 0, 0, 0);

  // Helper: create an epoch-second timestamp at a specific local
  // calendar date + time, so the test doesn't depend on the host TZ.
  const localTs = (year: number, month0: number, day: number, hour = 0, minute = 0): number => {
    const d = new Date();
    d.setFullYear(year, month0, day);
    d.setHours(hour, minute, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };

  it('renders "Today · <time>" for the same calendar day', () => {
    const ts = localTs(2026, 4 /* May */, 3, 8, 30);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out.startsWith('Today · ')).toBe(true);
  });

  it('renders "Yesterday · <time>" for the previous day', () => {
    const ts = localTs(2026, 4 /* May */, 2, 22, 15);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out.startsWith('Yesterday · ')).toBe(true);
  });

  it('renders an explicit short date for older entries', () => {
    const ts = localTs(2026, 3 /* April */, 10, 9, 0);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out.startsWith('Today · ')).toBe(false);
    expect(out.startsWith('Yesterday · ')).toBe(false);
    // Compute the expected localised date substring at runtime so the
    // assertion is locale-agnostic — on `de-DE` Intl renders "10. Apr."
    // / "10 avr." / numeric forms in other locales, all of which are
    // correct outputs of the implementation.
    const expectedDateStr = new Date(ts * 1000).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    expect(out).toContain(expectedDateStr);
    expect(out).toContain(' · ');
  });

  it('includes the year when older than the current year', () => {
    const ts = localTs(2024, 11 /* December */, 31, 10, 0);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out).toContain('2024');
  });
});
