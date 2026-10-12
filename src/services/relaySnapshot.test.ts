import type { Event } from 'nostr-tools';
import { collectRelaySnapshot } from './relaySnapshot';
import { listingFilters } from '../utils/marketListingsQuery';

jest.mock('./nostrPool', () => ({ pool: {} }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function start() {
  const filters = listingFilters(
    Array.from({ length: 216 }, (_, i) => i.toString(16).padStart(64, '0')),
  );
  const callbacks: { oneose: () => void; onclose: () => void; onevent: (e: Event) => void }[] = [];
  let active = 0;
  let peak = 0;
  const subscribe = jest.fn((_filters, cb) => {
    callbacks.push(cb);
    peak = Math.max(peak, ++active);
    let closed = false;
    return {
      close: jest.fn(() => {
        if (!closed) active--;
        closed = true;
        cb.onclose();
      }),
    };
  });
  const controller = new AbortController();
  const onEvent = jest.fn();
  const pending = collectRelaySnapshot({
    urls: ['wss://example.com'],
    filters,
    maxConcurrentFilters: 2,
    signal: controller.signal,
    deadline: Date.now() + 10000,
    graceMs: 1000,
    onEvent,
    relayPool: { ensureRelay: jest.fn().mockResolvedValue({ subscribe }) },
  });
  return {
    pending,
    callbacks,
    subscribe,
    controller,
    onEvent,
    peak: () => peak,
    active: () => active,
    filters,
  };
}

it('chunks 216 authors and opens at most two filters per relay, answering only after all chunks', async () => {
  const h = start();
  await Promise.resolve();
  expect(h.subscribe).toHaveBeenCalledTimes(2);
  h.callbacks[0].oneose();
  h.callbacks[0].oneose(); // A duplicate EOSE cannot open extra chunks.
  await Promise.resolve();
  expect(h.subscribe).toHaveBeenCalledTimes(3);
  h.callbacks[1].oneose();
  await Promise.resolve();
  expect(h.subscribe).toHaveBeenCalledTimes(4);
  h.callbacks[2].oneose();
  h.callbacks[3].oneose();
  expect(await h.pending).toMatchObject({ answered: ['wss://example.com'] });
  expect(h.subscribe.mock.calls.map(([filters]) => filters[0])).toEqual(h.filters);
  expect(h.peak()).toBe(2);
  expect(h.active()).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['abort', 'deadline', 'close'] as const)(
  'cleans up bounded subscriptions on %s without reporting an incomplete relay as answered',
  async (reason) => {
    const h = start();
    await Promise.resolve();
    if (reason === 'abort') h.controller.abort();
    else if (reason === 'deadline') jest.advanceTimersByTime(10000);
    else {
      h.callbacks[0].onclose();
      h.callbacks[1].oneose();
      await Promise.resolve();
      h.callbacks[2].oneose();
      h.callbacks[3].oneose();
    }
    expect(await h.pending).toMatchObject({ answered: [] });
    h.callbacks[0].onevent({ created_at: 1 } as Event);
    expect(h.onEvent).not.toHaveBeenCalled();
    expect(h.active()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);
