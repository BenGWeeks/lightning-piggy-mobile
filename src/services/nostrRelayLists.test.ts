import { publishToRelays, fetchLatestReplaceable } from './nostrRelayLists';
import { pool } from './nostrPool';
import { relayAllowsKind } from './relayKindPolicy';
import { RELAY_SKIPPED_REASON } from './relayHealth';
import type { Event } from 'nostr-tools';

jest.mock('./relayKindPolicy', () => ({ relayAllowsKind: jest.fn(async () => true) }));

jest.mock('./nostrPool', () => ({
  pool: { publish: jest.fn(), querySync: jest.fn() },
  trackRelays: jest.fn(),
}));
const mockAllowsKind = relayAllowsKind as jest.Mock;
const publish = pool.publish as jest.Mock;
const query = pool.querySync as jest.Mock;
const event = { id: 'e', kind: 10002 } as unknown as Event;
const PK = 'a'.repeat(64);
const ev = (id: string, created_at: number, over: Partial<Event> = {}) =>
  ({ id, created_at, pubkey: PK, kind: 10002, tags: [], content: '', sig: '', ...over }) as Event;

describe('publishToRelays', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

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
  it("counts nostr-tools' resolved 'connection failure' as a failure, not an accept", async () => {
    publish.mockReturnValue([Promise.resolve('connection failure: Error: getaddrinfo ENOTFOUND')]);
    expect(await publishToRelays(event, ['wss://down.example'])).toEqual([
      {
        url: 'wss://down.example',
        ok: false,
        message: 'connection failure: Error: getaddrinfo ENOTFOUND',
      },
    ]);
  });
});

describe('fetchLatestReplaceable', () => {
  it('returns the NEWEST version even when an older copy arrives first', async () => {
    query.mockResolvedValue([ev('old', 100), ev('new', 300), ev('mid', 200)]);
    expect((await fetchLatestReplaceable(PK, 10002, ['wss://a']))?.id).toBe('new');
    expect(query.mock.calls[0][1]).toEqual({ kinds: [10002], authors: [PK] });
  });

  it("ignores other authors' and other kinds' events", async () => {
    query.mockResolvedValue([
      ev('mine', 100),
      ev('forged', 999, { pubkey: 'b'.repeat(64) }),
      ev('wrongkind', 999, { kind: 1 }),
    ]);
    expect((await fetchLatestReplaceable(PK, 10002, ['wss://a']))?.id).toBe('mine');
  });

  it('breaks a created_at tie by lowest id (NIP-01)', async () => {
    query.mockResolvedValue([ev('bbb', 100), ev('aaa', 100)]);
    expect((await fetchLatestReplaceable(PK, 10002, ['wss://a']))?.id).toBe('aaa');
  });

  it('returns null when nothing is found or the query fails', async () => {
    query.mockResolvedValue([]);
    expect(await fetchLatestReplaceable(PK, 10050, ['wss://a'])).toBeNull();
    query.mockRejectedValue(new Error('offline'));
    expect(await fetchLatestReplaceable(PK, 10050, ['wss://a'])).toBeNull();
  });
});

it('filters kind-denied targets before handing events to the pool and preserves outcomes', async () => {
  mockAllowsKind.mockImplementation(
    async (url: string, kind: number) => url !== 'wss://user.kindpag.es' || kind === 10002,
  );
  publish.mockReturnValue([Promise.resolve('ok')]);
  for (const kind of [10050, 10063]) {
    const results = await publishToRelays({ ...event, kind }, [
      'wss://user.kindpag.es',
      'wss://purplepag.es',
    ]);
    expect(publish).toHaveBeenLastCalledWith(
      ['wss://purplepag.es'],
      expect.objectContaining({ kind }),
    );
    expect(results).toEqual([
      {
        url: 'wss://user.kindpag.es',
        ok: false,
        skipped: 'kind',
        message: `kind ${kind} not accepted`,
      },
      { url: 'wss://purplepag.es', ok: true },
    ]);
  }
  publish.mockReturnValue([Promise.resolve('ok'), Promise.resolve('ok')]);
  await publishToRelays(event, ['wss://user.kindpag.es', 'wss://purplepag.es']);
  expect(publish).toHaveBeenLastCalledWith(['wss://user.kindpag.es', 'wss://purplepag.es'], event);
});
it('marks intentionally parked relays as skipped, never as genuine errors', async () => {
  mockAllowsKind.mockResolvedValue(true);
  publish.mockReturnValue([Promise.reject(new Error(RELAY_SKIPPED_REASON))]);
  expect(await publishToRelays(event, ['wss://nos.lol'])).toEqual([
    { url: 'wss://nos.lol', ok: false, skipped: 'unhealthy', message: RELAY_SKIPPED_REASON },
  ]);
});
it('never opens publish connections when every target is kind-filtered', async () => {
  mockAllowsKind.mockResolvedValue(false);
  publish.mockClear();
  expect(await publishToRelays({ ...event, kind: 10063 }, ['wss://user.kindpag.es'])).toEqual([
    {
      url: 'wss://user.kindpag.es',
      ok: false,
      skipped: 'kind',
      message: 'kind 10063 not accepted',
    },
  ]);
  expect(publish).not.toHaveBeenCalled();
});
