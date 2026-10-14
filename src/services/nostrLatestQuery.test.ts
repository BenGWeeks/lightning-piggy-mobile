import { fetchSingleLatest } from './nostrLatestQuery';
import { pool } from './nostrPool';
import type { Event } from 'nostr-tools/pure';

jest.mock('./nostrPool', () => ({
  pool: { subscribeManyEose: jest.fn() },
  trackRelays: jest.fn(),
}));
const filter = { kinds: [3], authors: ['me'], limit: 1 };
const parse = (tags: string[][]) => tags[0][1];
let handlers: Parameters<typeof pool.subscribeManyEose>[2];
let close: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  close = jest.fn();
  jest.mocked(pool.subscribeManyEose).mockImplementation((_urls, _filter, params) => {
    handlers = params;
    return { close };
  });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const event = (value: string, created_at: number) =>
  ({ tags: [['p', value]], created_at }) as Event;

test('persists first then latest when both responses and aggregate EOSE arrive in one turn', async () => {
  const writes: string[] = [];
  let cached: string | null = null;
  const persist = (value: string) => {
    writes.push(value);
    cached = value;
  };
  // Match fetchContactList's async wrapper and NostrContext's awaiting caller.
  const fetchContacts = async () =>
    await fetchSingleLatest(filter, ['wss://a', 'wss://b'], parse, { onLatest: persist });
  const refresh = (async () => {
    const first = await fetchContacts();
    if (first !== null) persist(first);
  })();

  handlers.onevent?.(event('old', 1));
  handlers.onevent?.(event('new', 2));
  handlers.onclose?.(['closed automatically on eose']);
  handlers.onclose?.(['socket closed']);
  expect(close).toHaveBeenCalledTimes(1);

  await refresh;
  jest.runOnlyPendingTimers();
  expect(writes).toEqual(['old', 'new']);
  expect(cached).toBe('new');
  expect(jest.getTimerCount()).toBe(0);
});

test('returns the first response and reports a newer response once at aggregate close', async () => {
  const onLatest = jest.fn();
  const result = fetchSingleLatest(filter, ['wss://a', 'wss://b'], parse, { onLatest });
  handlers.onevent?.(event('first', 1));
  await expect(result).resolves.toBe('first');
  handlers.onevent?.(event('newest', 2));
  expect(onLatest).not.toHaveBeenCalled();
  handlers.onclose?.(['closed automatically on eose']);
  expect(close).toHaveBeenCalledTimes(1);
  expect(onLatest).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  expect(onLatest).toHaveBeenCalledTimes(1);
  expect(onLatest).toHaveBeenCalledWith('newest');
  expect(jest.getTimerCount()).toBe(0);
});

test('an empty EOSE or socket close settles without holding timers', async () => {
  const result = fetchSingleLatest(filter, ['wss://a'], parse);
  handlers.onclose?.(['socket closed']);
  await expect(result).resolves.toBeNull();
  expect(close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('an abandoned latest read closes at its deadline', async () => {
  const result = fetchSingleLatest(filter, ['wss://a'], parse, {
    softTimeoutMs: 100,
    keepOpenMs: 100,
  });
  jest.advanceTimersByTime(100);
  await expect(result).resolves.toBeNull();
  expect(close).not.toHaveBeenCalled();
  jest.advanceTimersByTime(100);
  expect(close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('parse failure closes the subscription and rejects the read', async () => {
  const result = fetchSingleLatest(filter, ['wss://a'], () => {
    throw new Error('invalid response');
  });
  handlers.onevent?.(event('bad', 1));
  await expect(result).rejects.toThrow('invalid response');
  expect(close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
