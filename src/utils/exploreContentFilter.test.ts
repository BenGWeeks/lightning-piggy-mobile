// Verify the build-aware composition: a Piggy pubkey is hidden ONLY when
// the build is production. Dev / preview must let it through (Maestro).

jest.mock('expo-application', () => ({
  get applicationId() {
    return mockApplicationId;
  },
}));

import {
  isHiddenInProd,
  stripHiddenForPersist,
  visibleCaches,
  visibleEvents,
} from './exploreContentFilter';

let mockApplicationId: string | null = null;

const BIG_PIGGY = 'ccedbff9a6f261b388078b70225dfa4147efaab5f062a7722a0d253f0360c7e7';
const REAL_USER = '1111111111111111111111111111111111111111111111111111111111111111';

describe('isHiddenInProd', () => {
  afterEach(() => {
    mockApplicationId = null;
  });

  it('hides a Piggy test account in the production build', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(isHiddenInProd(BIG_PIGGY)).toBe(true);
  });

  it('does NOT hide a Piggy in the dev build', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(isHiddenInProd(BIG_PIGGY)).toBe(false);
  });

  it('does NOT hide a Piggy in the preview build', () => {
    mockApplicationId = 'com.lightningpiggy.app.preview';
    expect(isHiddenInProd(BIG_PIGGY)).toBe(false);
  });

  it('never hides a real user, even in production', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(isHiddenInProd(REAL_USER)).toBe(false);
  });
});

describe('stripHiddenForPersist', () => {
  interface Item {
    id: string;
    pubkey: string;
  }
  const items: Item[] = [
    { id: 'piggy', pubkey: BIG_PIGGY },
    { id: 'real', pubkey: REAL_USER },
  ];
  const getPubkey = (i: Item) => i.pubkey;

  afterEach(() => {
    mockApplicationId = null;
  });

  it('drops prod test-account items so the cache self-heals in production', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(stripHiddenForPersist(items, getPubkey).map((i) => i.id)).toEqual(['real']);
  });

  it('persists everything (incl. Piggies) in dev / preview', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(stripHiddenForPersist(items, getPubkey).map((i) => i.id)).toEqual(['piggy', 'real']);
  });

  it('returns a fresh array (never mutates the input)', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    const out = stripHiddenForPersist(items, getPubkey);
    expect(out).not.toBe(items);
  });
});

describe('visibleCaches (rail + mini-map)', () => {
  interface Cache {
    id: string;
    pubkey: string;
  }
  const caches: Cache[] = [
    { id: 'piggy', pubkey: BIG_PIGGY },
    { id: 'real', pubkey: REAL_USER },
  ];
  const getPubkey = (c: Cache) => c.pubkey;

  afterEach(() => {
    mockApplicationId = null;
  });

  it('hides prod test-account Piglets so the mini-map matches the rail', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(visibleCaches(caches, getPubkey).map((c) => c.id)).toEqual(['real']);
  });

  it('shows everything in dev / preview', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(visibleCaches(caches, getPubkey).map((c) => c.id)).toEqual(['piggy', 'real']);
  });
});

describe('visibleEvents (rail + mini-map)', () => {
  const NOW = 1_000_000_000;
  interface Event {
    id: string;
    pubkey: string;
    startsAt: number | null;
    endsAt: number | null;
  }
  const futureReal: Event = {
    id: 'future-real',
    pubkey: REAL_USER,
    startsAt: NOW + 3600,
    endsAt: null,
  };
  const pastReal: Event = {
    id: 'past-real',
    pubkey: REAL_USER,
    startsAt: NOW - 3600,
    endsAt: null,
  };
  const futurePiggy: Event = {
    id: 'future-piggy',
    pubkey: BIG_PIGGY,
    startsAt: NOW + 3600,
    endsAt: null,
  };
  const getPubkey = (e: Event) => e.pubkey;

  afterEach(() => {
    mockApplicationId = null;
  });

  it('drops PAST events on every build', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(visibleEvents([futureReal, pastReal], getPubkey, NOW).map((e) => e.id)).toEqual([
      'future-real',
    ]);
  });

  it('drops future PIGGY events in production but keeps real future events', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(
      visibleEvents([futureReal, futurePiggy, pastReal], getPubkey, NOW).map((e) => e.id),
    ).toEqual(['future-real']);
  });

  it('keeps future Piggy events in dev / preview (only past dropped)', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(
      visibleEvents([futureReal, futurePiggy, pastReal], getPubkey, NOW).map((e) => e.id),
    ).toEqual(['future-real', 'future-piggy']);
  });
});
