import { AbstractRelay } from 'nostr-tools/abstract-relay';
import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import { pool } from './nostrPool';
import { fetchProfilesBatch } from './nostrProfileBatch';

jest.mock('./nostrPool', () => ({
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

test('accepts a profile after SDK default synthetic EOSE but before the ten-second deadline', async () => {
  const pubkey = 'a'.repeat(64);
  const onEvent = jest.fn();
  const result = fetchProfilesBatch([pubkey], ['wss://slow.example/'], 10_000, onEvent);
  await jest.advanceTimersByTimeAsync(4500);
  const sub = [...relay.openSubs.values()][0];
  expect(sub).toBeDefined();
  sub.onevent?.({ pubkey, content: '{}', created_at: 1 } as Event);
  await expect(result).resolves.toBeUndefined();
  expect(onEvent).toHaveBeenCalledWith({ pubkey, content: '{}', created_at: 1 });
  expect(relay.openSubs.size).toBe(0);
  // The SDK keeps its synthetic EOSE timer after caller close; it must be harmless.
  await jest.advanceTimersByTimeAsync(5500);
  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
