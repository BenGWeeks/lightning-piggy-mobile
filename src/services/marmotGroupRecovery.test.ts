import type { Event, Filter } from 'nostr-tools';
import { createGroupRecovery } from './marmotGroupRecovery';

const event = (id: string, time: number, h = 'quiet') =>
  ({
    id,
    created_at: time,
    kind: 445,
    tags: [['h', h]],
    content: '',
    pubkey: 'p',
    sig: 's',
  }) as Event;
const filter: Filter = { kinds: [445], '#h': ['quiet'], since: 100, limit: 500 };

beforeEach(() => jest.useFakeTimers({ now: 2_000_000 }));
afterEach(() => jest.useRealTimers());

test('buffers live traffic behind recovery, deduplicates overlap, and reuses only its own cursor', async () => {
  let resolve!: (events: Event[]) => void;
  const request = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Event[]>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue([]);
  const next = jest.fn();
  const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
  const pending = recovery.recover();
  expect(recovery.recover()).toBe(pending);
  await Promise.resolve();
  recovery.receive(event('live', 1900));
  recovery.receive(event('live', 1900));
  expect(next).not.toHaveBeenCalled();
  resolve([event('commit', 1200)]);
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  expect(next.mock.calls.map(([e]) => e.id)).toEqual(['commit', 'live']);
  await recovery.recover();
  expect(request.mock.calls.at(-1)[1]).toMatchObject({ '#h': ['quiet'], since: 1300, limit: 500 });
  recovery.receive(event('future', 99999));
  await recovery.recover();
  expect(request.mock.calls.at(-1)[1].since).toBe(1300);
  recovery.close();
});

test('unsubscribe aborts an outstanding page and prevents delivery or further pages', async () => {
  let resolve!: (events: Event[]) => void;
  const request = jest.fn(
    (_urls, _filter, _signal) =>
      new Promise<Event[]>((r) => {
        resolve = r;
      }),
  );
  const next = jest.fn();
  const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
  const pending = recovery.recover();
  await Promise.resolve();
  recovery.close();
  expect(request.mock.calls[0][2].aborted).toBe(true);
  resolve([event('commit', 101)]);
  await pending;
  expect(request).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  await recovery.recover();
  expect(request).toHaveBeenCalledTimes(1);
});

test('a failed recovery holds live delivery and retries from the unchanged cursor', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const request = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  const next = jest.fn();
  const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
  await recovery.recover();
  recovery.receive(event('live', 1900));
  expect(next).not.toHaveBeenCalled();
  await recovery.recover();
  expect(request.mock.calls[1][1].since).toBe(100);
  expect(next).toHaveBeenCalledWith(event('live', 1900));
  recovery.close();
  warning.mockRestore();
});

test.each([false, true])(
  'paces 10,000 buffered events and handles mid-drain arrivals/abort (%s)',
  async (cancel) => {
    let resolve!: (events: Event[]) => void;
    const request = jest.fn(
      () =>
        new Promise<Event[]>((r) => {
          resolve = r;
        }),
    );
    const next = jest.fn();
    const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
    const pending = recovery.recover();
    await Promise.resolve();
    for (let i = 9999; i >= 0; i--) recovery.receive(event(String(i), 100 + i));
    resolve([]);
    // Flush microtasks only: the real scheduler must stop at a macrotask yield.
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(next.mock.calls.length).toBeGreaterThan(0);
    expect(next.mock.calls.length).toBeLessThanOrEqual(32);
    recovery.receive(event('arrived-during-drain', 11000));
    if (cancel) recovery.close();
    const deliveredBeforeTimers = next.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1000);
    await pending;
    if (cancel) expect(next).toHaveBeenCalledTimes(deliveredBeforeTimers);
    else {
      expect(next.mock.calls.map(([e]) => e.id)).toEqual([
        ...Array.from({ length: 10000 }, (_, i) => String(i)),
        'arrived-during-drain',
      ]);
    }
    recovery.close();
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('unsubscribe cancels recovery backoff without another request', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const request = jest.fn().mockRejectedValue(new Error('offline'));
  const recovery = createGroupRecovery(['wss://r/'], [filter], jest.fn(), request);
  await recovery.recover();
  expect(jest.getTimerCount()).toBe(1);
  recovery.close();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  warning.mockRestore();
});
