import { isFutureEvent, hideTestContentInProd } from './futureEvent';

// Fixed reference "now": 2026-06-20T12:00:00Z = 1781006400 unix seconds.
const NOW = Math.floor(Date.UTC(2026, 5, 20, 12, 0, 0) / 1000);
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

describe('isFutureEvent', () => {
  it('keeps an event with no timing at all (Time TBA)', () => {
    expect(isFutureEvent({ startsAt: null, endsAt: null }, NOW)).toBe(true);
  });

  it('keeps an event that is still in progress (started in the past, ends in the future)', () => {
    expect(isFutureEvent({ startsAt: NOW - 2 * HOUR, endsAt: NOW + 2 * HOUR }, NOW)).toBe(true);
  });

  it('drops an event that has already ended', () => {
    expect(isFutureEvent({ startsAt: NOW - 4 * HOUR, endsAt: NOW - 2 * HOUR }, NOW)).toBe(false);
  });

  it('keeps an event ending exactly now (inclusive boundary)', () => {
    expect(isFutureEvent({ startsAt: NOW - HOUR, endsAt: NOW }, NOW)).toBe(true);
  });

  it('keeps a timed start-only event in the future', () => {
    expect(isFutureEvent({ startsAt: NOW + HOUR, endsAt: null }, NOW)).toBe(true);
  });

  it('drops a timed start-only event in the past (no 1h grace — past is past)', () => {
    // The OLD behaviour allowed a 1h grace window; the "17 May" style
    // stale events are exactly what that let linger. Assert it's gone.
    expect(isFutureEvent({ startsAt: NOW - 30 * 60, endsAt: null }, NOW)).toBe(false);
  });

  describe('all-day (date-based) events', () => {
    // An all-day event has its start pinned to a midnight (day) boundary.
    const todayMidnight = Math.floor(NOW / DAY) * DAY; // 2026-06-20T00:00:00Z

    it('keeps an all-day event happening TODAY (not past until the day ends)', () => {
      // NOW is midday; the all-day event started at 00:00 today.
      expect(isFutureEvent({ startsAt: todayMidnight, endsAt: null }, NOW)).toBe(true);
    });

    it('keeps an all-day event in the future', () => {
      expect(isFutureEvent({ startsAt: todayMidnight + DAY, endsAt: null }, NOW)).toBe(true);
    });

    it('drops an all-day event from a previous day', () => {
      expect(isFutureEvent({ startsAt: todayMidnight - DAY, endsAt: null }, NOW)).toBe(false);
    });

    it('keeps a yesterday all-day event right up to the end of its day', () => {
      const yesterdayMidnight = todayMidnight - DAY;
      // One second before yesterday's day-end boundary, with now set there.
      const justBeforeDayEnd = yesterdayMidnight + DAY - 1;
      expect(isFutureEvent({ startsAt: yesterdayMidnight, endsAt: null }, justBeforeDayEnd)).toBe(
        true,
      );
    });
  });
});

describe('hideTestContentInProd', () => {
  interface Item {
    id: string;
    pubkey: string;
  }
  const items: Item[] = [
    { id: 'a', pubkey: 'test-pig' },
    { id: 'b', pubkey: 'real-user' },
    { id: 'c', pubkey: 'test-pig' },
  ];
  const getPubkey = (i: Item) => i.pubkey;
  const isHidden = (pk: string) => pk === 'test-pig';

  it('strips test-account items in production', () => {
    const out = hideTestContentInProd(items, getPubkey, isHidden, true);
    expect(out.map((i) => i.id)).toEqual(['b']);
  });

  it('passes everything through in non-production (dev / preview)', () => {
    const out = hideTestContentInProd(items, getPubkey, isHidden, false);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns a fresh array (does not mutate the input) even in dev', () => {
    const out = hideTestContentInProd(items, getPubkey, isHidden, false);
    expect(out).not.toBe(items);
    expect(out).toEqual(items);
  });
});
