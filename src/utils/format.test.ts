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
  // Pin a fixed "now" so the same input always produces the same Today/
  // Yesterday/explicit-date branch regardless of when the test runs.
  const NOW = new Date('2026-05-03T12:00:00.000Z');

  it('renders "Today · <time>" for the same calendar day', () => {
    const ts = Math.floor(new Date('2026-05-03T08:30:00.000Z').getTime() / 1000);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out.startsWith('Today · ')).toBe(true);
  });

  it('renders "Yesterday · <time>" for the previous day', () => {
    const ts = Math.floor(new Date('2026-05-02T22:15:00.000Z').getTime() / 1000);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out.startsWith('Yesterday · ')).toBe(true);
  });

  it('renders an explicit short date for older entries', () => {
    const ts = Math.floor(new Date('2026-04-10T09:00:00.000Z').getTime() / 1000);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out.startsWith('Today · ')).toBe(false);
    expect(out.startsWith('Yesterday · ')).toBe(false);
    // The date half should reference April; we don't lock the exact
    // locale-driven shape ("10 Apr" vs "Apr 10") because Node's Intl
    // formatting is locale-dependent.
    expect(out).toMatch(/Apr/i);
    expect(out).toContain(' · ');
  });

  it('includes the year when older than the current year', () => {
    const ts = Math.floor(new Date('2024-12-31T10:00:00.000Z').getTime() / 1000);
    const out = formatFriendlyDateTime(ts, NOW);
    expect(out).toContain('2024');
  });
});
