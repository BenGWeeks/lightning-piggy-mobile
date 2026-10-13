import { fetchMarketMerchantProfiles } from './marketMerchantProfiles';
import { querySyncAbortable } from './relayQuery';
import * as cache from './zapSenderProfileStorage';
import { PROFILE_RELAYS } from './nostrRelayDefaults';
import type { Event } from 'nostr-tools';
jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
jest.mock('./zapSenderProfileStorage', () => ({ getMany: jest.fn(), setMany: jest.fn() }));
const query = querySyncAbortable as jest.Mock;
const cached = cache.getMany as jest.Mock;
const save = cache.setMany as jest.Mock;
const key = (i: number) => i.toString(16).padStart(64, '0');
const event = (pubkey: string, created_at: number, name: string) =>
  ({
    pubkey,
    created_at,
    kind: 0,
    content: JSON.stringify({ name, lud16: 'unverified@example.com' }),
  }) as Event;
beforeEach(() => {
  jest.clearAllMocks();
  cached.mockResolvedValue(new Map());
  query.mockResolvedValue([]);
  save.mockResolvedValue(undefined);
});
it('queries every cache miss in bounded chunks using the profile relays', async () => {
  const authors = Array.from({ length: 216 }, (_, i) => key(i));
  const signal = new AbortController().signal;
  await fetchMarketMerchantProfiles(authors, signal);
  expect(query).toHaveBeenCalledTimes(5);
  const requested: string[] = [];
  for (const [, relays, filter, options] of query.mock.calls) {
    expect(relays).toEqual(PROFILE_RELAYS);
    expect(filter.kinds).toEqual([0]);
    expect(filter.authors.length).toBeLessThanOrEqual(50);
    expect(filter.limit).toBeLessThanOrEqual(100);
    expect(options).toEqual({ signal, maxWait: 8000 });
    requested.push(...filter.authors);
  }
  expect(requested).toEqual(authors);
});
it('reuses cache, chooses newest metadata and ignores unsolicited profiles', async () => {
  cached.mockResolvedValue(new Map([[key(0), { name: 'Cached' }]]));
  query.mockResolvedValue([
    event(key(1), 20, 'Newest'),
    event(key(1), 10, 'Old'),
    event(key(2), 30, 'Unsolicited'),
  ]);
  const profiles = await fetchMarketMerchantProfiles(
    [key(0), key(1)],
    new AbortController().signal,
  );
  expect(query.mock.calls[0][2].authors).toEqual([key(1)]);
  expect(profiles.get(key(0))?.name).toBe('Cached');
  expect(profiles.get(key(1))?.name).toBe('Newest');
  expect(profiles.has(key(2))).toBe(false);
  expect(profiles.get(key(1))).not.toHaveProperty('lud16');
  expect(save).toHaveBeenCalledTimes(1);
});
it('cancels without persisting partial results', async () => {
  const controller = new AbortController();
  controller.abort();
  await fetchMarketMerchantProfiles([key(1)], controller.signal);
  expect(query).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
