import type { Event } from 'nostr-tools';
import {
  SellerFetchError,
  StaleRevisionError,
  isNewerRevision,
  resolveCurrentRevision,
} from './marketSellerRevision';

const rev = (id: string, created_at: number) => ({ id, created_at }) as Event;

describe('resolveCurrentRevision', () => {
  it('refuses to continue when relays time out or fail (unknown is not "no shop")', async () => {
    await expect(
      resolveCurrentRevision({
        fetchLatest: () => Promise.reject(new Error('Relay query timed out before EOSE')),
        base: null,
      }),
    ).rejects.toBeInstanceOf(SellerFetchError);
  });

  it('flags a shop a first-time setup did not know about', async () => {
    const latest = rev('a', 10);
    const err = await resolveCurrentRevision({ fetchLatest: async () => latest, base: null }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(StaleRevisionError);
    expect(err.latest).toBe(latest);
    expect(err.base).toBeNull();
  });

  it('flags a newer revision than the cached form was loaded from', async () => {
    const onLatest = jest.fn();
    await expect(
      resolveCurrentRevision({
        fetchLatest: async () => rev('b', 20),
        base: rev('a', 10),
        onLatest,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    expect(onLatest).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('builds on the newer revision once the user confirms', async () => {
    const latest = rev('b', 20);
    await expect(
      resolveCurrentRevision({ fetchLatest: async () => latest, base: rev('a', 10), force: true }),
    ).resolves.toBe(latest);
  });

  it('accepts an unchanged revision, a lagging relay, and a completed empty answer', async () => {
    const base = rev('a', 10);
    await expect(resolveCurrentRevision({ fetchLatest: async () => base, base })).resolves.toBe(
      base,
    );
    await expect(
      resolveCurrentRevision({ fetchLatest: async () => rev('old', 5), base }),
    ).resolves.toBe(base);
    await expect(resolveCurrentRevision({ fetchLatest: async () => null, base })).resolves.toBe(
      base,
    );
    await expect(
      resolveCurrentRevision({ fetchLatest: async () => null, base: null }),
    ).resolves.toBe(null);
  });

  it('orders same-second revisions by lowest id (NIP-01)', () => {
    expect(isNewerRevision(rev('a', 10), rev('b', 10))).toBe(true);
    expect(isNewerRevision(rev('b', 10), rev('a', 10))).toBe(false);
    expect(isNewerRevision(rev('a', 1), null)).toBe(true);
  });
});
