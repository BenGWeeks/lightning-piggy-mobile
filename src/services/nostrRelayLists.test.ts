import { publishToRelays, fetchDmInboxRelays } from './nostrRelayLists';
import { pool } from './nostrPool';
import { fetchSingleLatest } from './nostrService';
import type { Event } from 'nostr-tools';

jest.mock('./nostrPool', () => ({ pool: { publish: jest.fn() }, trackRelays: jest.fn() }));
jest.mock('./nostrService', () => ({ fetchSingleLatest: jest.fn() }));
const publish = pool.publish as jest.Mock;
const fetchLatest = fetchSingleLatest as jest.Mock;
const event = { id: 'e', kind: 10002 } as unknown as Event;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('publishToRelays', () => {
  it('reports per-relay acceptance, rejection reasons and timeouts', async () => {
    publish.mockReturnValue([
      Promise.resolve('ok'),
      Promise.reject(new Error('rate-limited: slow down')),
      new Promise(() => {}),
    ]);
    const pending = publishToRelays(event, ['wss://a', 'wss://b', 'wss://c'], 8000);
    await jest.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual([
      { url: 'wss://a', ok: true },
      { url: 'wss://b', ok: false, message: 'rate-limited: slow down' },
      { url: 'wss://c', ok: false, message: 'timed out' },
    ]);
  });
});

describe('fetchDmInboxRelays', () => {
  it('queries kind 10050 on the given relays plus the indexers', async () => {
    fetchLatest.mockResolvedValue(['wss://relay.primal.net']);
    expect(await fetchDmInboxRelays('pk', ['wss://nos.lol'])).toEqual(['wss://relay.primal.net']);
    const [filter, relays] = fetchLatest.mock.calls[0];
    expect(filter).toEqual({ kinds: [10050], authors: ['pk'] });
    expect(relays).toEqual(['wss://nos.lol', 'wss://purplepag.es', 'wss://user.kindpag.es']);
  });

  it('returns null rather than throwing when relays are unreachable', async () => {
    fetchLatest.mockRejectedValue(new Error('offline'));
    expect(await fetchDmInboxRelays('pk', [])).toBeNull();
  });
});
