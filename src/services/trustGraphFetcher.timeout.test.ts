import { AbstractRelay } from 'nostr-tools/abstract-relay';
import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import { pool } from './nostrService';
import { fetchL2Follows } from './trustGraphFetcher';

jest.mock('./nostrService', () => ({
  pool: new (jest.requireActual('nostr-tools/pool').SimplePool)(),
  trackRelays: jest.fn(),
  DEFAULT_RELAYS: ['wss://slow.example/'],
}));

let relay: AbstractRelay;
beforeEach(() => {
  jest.useFakeTimers();
  relay = new AbstractRelay('wss://slow.example/', {
    verifyEvent: (event): event is VerifiedEvent => true,
  });
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
});
afterEach(() => {
  relay.close();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('retains a slow follow-list response until the twelve-second deadline without wire EOSE', async () => {
  const pubkey = 'a'.repeat(64);
  const follow = 'b'.repeat(64);
  const result = fetchL2Follows(new Set([pubkey]), ['wss://slow.example/']);
  await jest.advanceTimersByTimeAsync(11_000);
  const sub = [...relay.openSubs.values()][0];
  expect(sub).toBeDefined();
  sub.onevent?.({ pubkey, tags: [['p', follow]], created_at: 1 } as Event);
  await jest.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toEqual(new Set([follow]));
  expect(relay.openSubs.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
