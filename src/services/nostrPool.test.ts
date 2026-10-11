import { SimplePool } from 'nostr-tools/pool';
import type { Event as NostrEvent } from 'nostr-tools/pure';

import { pool } from './nostrPool';
import {
  RELAY_CONNECT_TIMEOUT_MS,
  RELAY_SKIPPED_REASON,
  __resetRelayHealthForTests,
  isRelayParked,
  recordRelayFailure,
  recordRelaySuccess,
} from './relayHealth';

const DEAD = 'wss://dead.example/';
const A = 'wss://a.example/';
const B = 'wss://b.example/';
const EVENT = { id: 'x' } as NostrEvent;

function park(url: string) {
  for (let i = 0; i < 2; i++) {
    recordRelaySuccess('wss://witness.example/');
    recordRelayFailure(url);
  }
  expect(isRelayParked(url)).toBe(true);
}

let superPublish: jest.SpyInstance;
let superSubscribeMap: jest.SpyInstance;

beforeEach(() => {
  __resetRelayHealthForTests();
  superPublish = jest
    .spyOn(SimplePool.prototype, 'publish')
    .mockImplementation((relays: string[]) => relays.map((r) => Promise.resolve(`ok ${r}`)));
  superSubscribeMap = jest
    .spyOn(SimplePool.prototype, 'subscribeMap')
    .mockImplementation(() => ({ close: () => {} }));
});

afterEach(() => {
  jest.restoreAllMocks();
  __resetRelayHealthForTests(); // cancels the debounced persist timer
});

describe('publish', () => {
  it('passes everything through when no relay is parked', async () => {
    const results = await Promise.all(pool.publish([A, B, DEAD], EVENT));
    expect(superPublish).toHaveBeenCalledWith([A, B, DEAD], EVENT, undefined);
    expect(results).toEqual([`ok ${A}`, `ok ${B}`, `ok ${DEAD}`]);
  });

  it('skips a parked relay, keeping results aligned with the input', async () => {
    park(DEAD);
    const settled = await Promise.allSettled(pool.publish([A, DEAD, B], EVENT));
    expect(superPublish).toHaveBeenCalledWith([A, B], EVENT, undefined);
    expect(settled).toEqual([
      { status: 'fulfilled', value: `ok ${A}` },
      { status: 'rejected', reason: new Error(RELAY_SKIPPED_REASON) },
      { status: 'fulfilled', value: `ok ${B}` },
    ]);
  });

  it('still publishes somewhere when every relay is parked', async () => {
    park(DEAD);
    park(A);
    await Promise.allSettled(pool.publish([DEAD, A], EVENT));
    expect(superPublish).toHaveBeenCalledWith([DEAD, A], EVENT, undefined);
  });
});

describe('subscriptions', () => {
  it('leave parked relays out of the request', () => {
    park(DEAD);
    pool.subscribeMany([A, DEAD, B], { kinds: [0] }, {});
    const requests = superSubscribeMap.mock.calls[0][0] as { url: string }[];
    expect(requests.map((r) => r.url)).toEqual([A, B]);
  });
});

describe('ensureRelay', () => {
  it('caps the connect timeout and records a new connection as healthy', async () => {
    park(DEAD);
    const ensure = jest
      .spyOn(SimplePool.prototype, 'ensureRelay')
      .mockResolvedValue({} as Awaited<ReturnType<SimplePool['ensureRelay']>>);
    await pool.ensureRelay(DEAD, { connectionTimeout: 12_000 });
    expect(ensure).toHaveBeenCalledWith(DEAD, { connectionTimeout: RELAY_CONNECT_TIMEOUT_MS });
    expect(isRelayParked(DEAD)).toBe(false);
  });

  it('records a failed connection, but not an aborted one', async () => {
    jest.spyOn(SimplePool.prototype, 'ensureRelay').mockRejectedValue('connection timed out');
    recordRelaySuccess('wss://witness.example/');
    const aborted = new AbortController();
    aborted.abort();
    await expect(pool.ensureRelay(DEAD, { abort: aborted.signal })).rejects.toBe(
      'connection timed out',
    );
    await expect(pool.ensureRelay(DEAD, { abort: aborted.signal })).rejects.toBeDefined();
    expect(isRelayParked(DEAD)).toBe(false);
    await expect(pool.ensureRelay(DEAD)).rejects.toBeDefined();
    await expect(pool.ensureRelay(DEAD)).rejects.toBeDefined();
    expect(isRelayParked(DEAD)).toBe(true);
  });
});
