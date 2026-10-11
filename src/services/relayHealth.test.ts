import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CORROBORATION_WINDOW_MS,
  PARK_BASE_MS,
  PARK_MAX_MS,
  __persistRelayHealthForTests,
  __resetRelayHealthForTests,
  hydrateRelayHealth,
  isRelayParked,
  noteNetworkActivity,
  parkedRelays,
  recordRelayFailure,
  recordRelaySuccess,
  selectHealthyRelays,
} from './relayHealth';

const DEAD = 'wss://dead.example';
const DEAD2 = 'wss://dead2.example';
const OK = 'wss://ok.example';
const OK2 = 'wss://ok2.example';
const T0 = 1_800_000_000_000;

/** Fail `url` n times, each one corroborated by `OK` connecting just before. */
function failCorroborated(url: string, n: number, start = T0): number {
  let t = start;
  for (let i = 0; i < n; i++) {
    recordRelaySuccess(OK, t);
    recordRelayFailure(url, t + 1);
    t += 1000;
  }
  return t;
}

beforeEach(async () => {
  __resetRelayHealthForTests();
  await AsyncStorage.clear();
});

// Cancels the debounced persist timer so no handle outlives the suite.
afterEach(() => __resetRelayHealthForTests());

describe('backoff', () => {
  it('parks a relay after 2 corroborated failures, for 15 min', () => {
    recordRelaySuccess(OK, T0);
    recordRelayFailure(DEAD, T0 + 1);
    expect(isRelayParked(DEAD, T0 + 2)).toBe(false);
    recordRelayFailure(DEAD, T0 + 2);
    expect(isRelayParked(DEAD, T0 + 3)).toBe(true);
    expect(isRelayParked(DEAD, T0 + 2 + PARK_BASE_MS - 1)).toBe(true);
    expect(isRelayParked(DEAD, T0 + 2 + PARK_BASE_MS)).toBe(false);
  });

  it('doubles the park per further failure, capped at 6 h', () => {
    let t = failCorroborated(DEAD, 2);
    // Park lapses, the relay gets one try, and fails again: 30 min.
    t += PARK_BASE_MS;
    recordRelaySuccess(OK, t);
    recordRelayFailure(DEAD, t);
    expect(isRelayParked(DEAD, t + 2 * PARK_BASE_MS - 1)).toBe(true);
    expect(isRelayParked(DEAD, t + 2 * PARK_BASE_MS)).toBe(false);
    // Many more failures never park it for longer than PARK_MAX_MS.
    for (let i = 0; i < 20; i++) {
      recordRelaySuccess(OK, t);
      recordRelayFailure(DEAD, t);
    }
    expect(isRelayParked(DEAD, t + PARK_MAX_MS - 1)).toBe(true);
    expect(isRelayParked(DEAD, t + PARK_MAX_MS)).toBe(false);
  });

  it('matches URLs the way the pool does (case, trailing slash)', () => {
    failCorroborated('wss://Dead.Example/', 2);
    expect(isRelayParked(DEAD, T0 + 5000)).toBe(true);
  });
});

describe('recovery', () => {
  it('a successful connection clears the failures and the park', () => {
    const t = failCorroborated(DEAD, 3);
    expect(isRelayParked(DEAD, t)).toBe(true);
    recordRelaySuccess(DEAD, t);
    expect(isRelayParked(DEAD, t)).toBe(false);
    expect(parkedRelays(t)).toEqual([]);
    // Back to square one: a single new failure doesn't re-park it.
    recordRelaySuccess(OK, t + 1);
    recordRelayFailure(DEAD, t + 2);
    expect(isRelayParked(DEAD, t + 3)).toBe(false);
  });
});

describe('offline protection (corroboration)', () => {
  it('does not park anything when no relay connects (phone offline)', () => {
    for (let i = 0; i < 5; i++) {
      recordRelayFailure(DEAD, T0 + i * 60_000);
      recordRelayFailure(OK, T0 + i * 60_000);
    }
    expect(parkedRelays(T0 + 5 * 60_000)).toEqual([]);
  });

  it('counts a failure seen just before the first success (cold start)', () => {
    // A refused connection loses the race to nothing: no success yet.
    recordRelayFailure(DEAD, T0);
    recordRelaySuccess(OK, T0 + 500); // confirms the earlier failure
    recordRelayFailure(DEAD, T0 + 5000);
    expect(isRelayParked(DEAD, T0 + 5001)).toBe(true);
  });

  it('forgets an unconfirmed failure when the next success is long after it', () => {
    recordRelayFailure(DEAD, T0);
    recordRelaySuccess(OK, T0 + CORROBORATION_WINDOW_MS + 1);
    recordRelayFailure(DEAD, T0 + CORROBORATION_WINDOW_MS + 2);
    expect(isRelayParked(DEAD, T0 + CORROBORATION_WINDOW_MS + 3)).toBe(false);
  });
});

describe('corroboration sources', () => {
  it("a relay's own earlier success doesn't corroborate its own failures", () => {
    recordRelaySuccess(DEAD, T0);
    recordRelayFailure(DEAD, T0 + 1000);
    recordRelayFailure(DEAD, T0 + 2000);
    expect(isRelayParked(DEAD, T0 + 3000)).toBe(false);
  });

  it('traffic on open sockets corroborates, long after the last new connection', () => {
    recordRelaySuccess(OK, T0);
    const later = T0 + 10 * 60_000; // healthy sockets stay open, no new connects
    noteNetworkActivity(later);
    recordRelayFailure(DEAD, later + 1);
    noteNetworkActivity(later + 5000);
    recordRelayFailure(DEAD, later + 5001);
    expect(isRelayParked(DEAD, later + 5002)).toBe(true);
  });
});

describe('selectHealthyRelays', () => {
  it('returns the list untouched when nothing is parked', () => {
    const list = [OK, DEAD, OK2];
    expect(selectHealthyRelays(list, T0)).toEqual(list);
  });

  it('drops parked relays, keeping order and spelling', () => {
    const t = failCorroborated(DEAD, 2);
    expect(selectHealthyRelays(['wss://ok.example/', DEAD, OK2], t)).toEqual([
      'wss://ok.example/',
      OK2,
    ]);
  });

  it('never skips every relay: keeps the healthiest 2', () => {
    let t = failCorroborated(DEAD, 3); // parked for 30 min
    t = failCorroborated(DEAD2, 2, t); // parked for 15 min: healthier
    const third = 'wss://dead3.example';
    t = failCorroborated(third, 4, t); // parked for 60 min
    expect(selectHealthyRelays([DEAD, DEAD2, third], t)).toEqual([DEAD, DEAD2]);
    // Exactly one healthy relay: one parked relay is added back.
    expect(selectHealthyRelays([third, OK2, DEAD], t)).toEqual([OK2, DEAD]);
  });

  it('keeps a lone parked relay (a one-relay list is never emptied)', () => {
    const t = failCorroborated(DEAD, 2);
    expect(selectHealthyRelays([DEAD], t)).toEqual([DEAD]);
    expect(selectHealthyRelays([], t)).toEqual([]);
  });
});

describe('persistence', () => {
  it('survives a restart, and a stale entry is forgotten', async () => {
    const t = failCorroborated(DEAD, 2);
    await __persistRelayHealthForTests();
    __resetRelayHealthForTests();
    expect(isRelayParked(DEAD, t)).toBe(false);

    await hydrateRelayHealth(t);
    expect(isRelayParked(DEAD, t)).toBe(true);

    __resetRelayHealthForTests();
    await hydrateRelayHealth(t + PARK_BASE_MS + PARK_MAX_MS + 1);
    expect(parkedRelays(t)).toEqual([]);
  });

  it('never restores a stored park for a relay that connected this session', async () => {
    const t = failCorroborated(DEAD, 2);
    await __persistRelayHealthForTests();
    __resetRelayHealthForTests();
    recordRelaySuccess(DEAD, t); // recovered before hydration finished
    await hydrateRelayHealth(t);
    expect(isRelayParked(DEAD, t)).toBe(false);
  });

  it('ignores garbage in storage', async () => {
    await AsyncStorage.setItem('nostr_relay_health_v1', '{"not":"a list"}');
    await expect(hydrateRelayHealth(T0)).resolves.toBeUndefined();
    await AsyncStorage.setItem('nostr_relay_health_v1', JSON.stringify([{ u: 1 }, null]));
    await hydrateRelayHealth(T0);
    expect(parkedRelays(T0)).toEqual([]);
  });
});
