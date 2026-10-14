import type { Event, Filter } from 'nostr-tools';
import { createGroupRecovery, MAX_BUFFERED_EVENTS } from './marmotGroupRecovery';

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
  'paces a full live buffer and handles mid-drain arrivals/abort (%s)',
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
    for (let i = MAX_BUFFERED_EVENTS - 1; i >= 0; i--) recovery.receive(event(String(i), 100 + i));
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
        ...Array.from({ length: MAX_BUFFERED_EVENTS }, (_, i) => String(i)),
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

test('relay-clamped pages that hit the page cap continue below the oldest event instead of delivering a truncated range', async () => {
  jest.setSystemTime(20_000_000_000);
  const all = Array.from({ length: 5000 }, (_, i) => event(`e${i}`, 1000 + i));
  // A relay that clamps every page to 100 events regardless of `limit`.
  const request = jest.fn(async (_urls: string[], f: Filter) =>
    all
      .filter((e) => e.created_at >= (f.since ?? 0) && e.created_at <= (f.until ?? Infinity))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 100),
  );
  const next = jest.fn();
  const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
  const pending = recovery.recover();
  await Promise.resolve();
  recovery.receive(event('live', 7000));
  await jest.advanceTimersByTimeAsync(500);
  await pending;
  // 40 pages × ≤100 events cannot be the whole range: nothing is delivered and
  // the cursor stays put, rather than skipping the ~1,000 oldest commits.
  expect(request).toHaveBeenCalledTimes(40);
  expect(next).not.toHaveBeenCalled();
  for (let i = 0; i < 10 && next.mock.calls.length <= 5000; i++)
    await jest.advanceTimersByTimeAsync(1000);
  expect(request.mock.calls[40]?.[1]).toMatchObject({ since: 100, until: 2039 });
  expect(next.mock.calls.map(([e]) => e.id)).toEqual([...all.map((e) => e.id), 'live']);
  expect(new Set(next.mock.calls.map(([e]) => e.id)).size).toBe(5001);
  const again = recovery.recover();
  await jest.advanceTimersByTimeAsync(100);
  await again;
  expect(request.mock.calls.at(-1)?.[1].since).toBe(7000 - 600);
  recovery.close();
  expect(jest.getTimerCount()).toBe(0);
});

test('an overflowing live buffer is dropped, the cursor retained, and the events re-read from history once', async () => {
  let resolve!: (events: Event[]) => void;
  const request = jest
    .fn()
    .mockImplementationOnce(() => new Promise<Event[]>((r) => (resolve = r)))
    .mockResolvedValue([]);
  const next = jest.fn();
  const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
  const pending = recovery.recover();
  await Promise.resolve();
  const live = Array.from({ length: MAX_BUFFERED_EVENTS + 1 }, (_, i) => event(`l${i}`, 1000 + i));
  for (const e of live) {
    recovery.receive(e);
    recovery.receive(e); // a second relay's copy must not count toward the bound
  }
  resolve([]);
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  // Survivors are not delivered: that would advance the cursor past the dropped ones.
  expect(next).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(live);
  await jest.advanceTimersByTimeAsync(1000);
  for (let i = 0; i < 10 && next.mock.calls.length < live.length; i++)
    await jest.advanceTimersByTimeAsync(1000);
  expect(request.mock.calls[1][1].since).toBe(100);
  expect(next.mock.calls.map(([e]) => e.id)).toEqual(live.map((e) => e.id));
  recovery.close();
  expect(jest.getTimerCount()).toBe(0);
});

test('duplicate live deliveries do not consume buffer capacity', async () => {
  let resolve!: (events: Event[]) => void;
  const request = jest
    .fn()
    .mockImplementationOnce(() => new Promise<Event[]>((r) => (resolve = r)))
    .mockResolvedValue([]);
  const next = jest.fn();
  const recovery = createGroupRecovery(['wss://r/'], [filter], next, request);
  const pending = recovery.recover();
  await Promise.resolve();
  const live = Array.from({ length: MAX_BUFFERED_EVENTS }, (_, i) => event(`l${i}`, 1000 + i));
  for (const e of live) for (let copies = 0; copies < 3; copies++) recovery.receive(e);
  resolve([]);
  for (let i = 0; i < 10 && next.mock.calls.length < live.length; i++)
    await jest.advanceTimersByTimeAsync(1000);
  await pending;
  expect(next.mock.calls.map(([e]) => e.id)).toEqual(live.map((e) => e.id));
  recovery.close();
});
