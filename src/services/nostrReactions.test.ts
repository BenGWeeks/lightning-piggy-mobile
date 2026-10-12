import { fetchReactions, fetchReactionDeletions } from './nostrReactions';
import { pool } from './nostrService';
import type { SubscriptionParams } from 'nostr-tools/abstract-relay';

jest.mock('./nostrService', () => ({
  pool: { ensureRelay: jest.fn() },
  trackRelays: jest.fn(),
}));

let callbacks: SubscriptionParams[];
let close: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  callbacks = [];
  close = jest.fn();
  (pool.ensureRelay as jest.Mock).mockResolvedValue({
    subscribe: jest.fn((_filters, params: SubscriptionParams) => {
      callbacks.push(params);
      return { close };
    }),
  });
});
afterEach(() => jest.useRealTimers());

it.each([fetchReactions, fetchReactionDeletions])(
  '%p returns authoritative empty results only after every relay sends EOSE',
  async (fetch) => {
    const result = fetch(['target'], ['wss://one', 'wss://two']);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    callbacks[0].oneose!();
    await Promise.resolve();
    expect(settled).toBe(false);
    callbacks[1].oneose!();
    await expect(result).resolves.toEqual([]);
    expect(close).toHaveBeenCalledTimes(2);
  },
);

it.each([fetchReactions, fetchReactionDeletions])(
  '%p rejects timeout before the library can synthesize EOSE',
  async (fetch) => {
    const result = fetch(['target'], ['wss://one']);
    const rejection = expect(result).rejects.toThrow('timed out');
    await Promise.resolve();
    expect(callbacks[0].eoseTimeout).toBeGreaterThan(10000);
    jest.advanceTimersByTime(10000);
    await rejection;
    callbacks[0].oneose!();
    expect(close).toHaveBeenCalledTimes(1);
  },
);

it('rejects closed/failed relays and missing relay configuration', async () => {
  const result = fetchReactions(['target'], ['wss://one']);
  const rejection = expect(result).rejects.toThrow('disconnected');
  await Promise.resolve();
  callbacks[0].onclose!('disconnected');
  await rejection;
  (pool.ensureRelay as jest.Mock).mockRejectedValueOnce(new Error('connection failed'));
  await expect(fetchReactions(['target'], ['wss://one'])).rejects.toThrow('connection failed');
  await expect(fetchReactions(['target'], [])).rejects.toThrow('No reaction read relays');
});
