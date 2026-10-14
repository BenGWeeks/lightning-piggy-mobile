import { SimplePool } from 'nostr-tools/pool';
import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { withRelayHealth } from './healthAwarePool';
import { querySyncAbortable } from './relayQuery';

jest.mock('./relayReqLimit', () => ({ discoverRelayReqLimit: async () => undefined }));
jest.mock('./relayHealth', () => ({
  selectHealthyRelays: (urls: string[]) => urls,
  noteNetworkActivity: jest.fn(),
}));
class TestPool extends withRelayHealth(SimplePool) {}
const url = 'wss://transport.example/';

test.each(['connection failed', 'connection timed out'])(
  'rejected connection promise (%s) rejects the read instead of succeeding empty',
  async (reason) => {
    const pool = new TestPool();
    jest.spyOn(pool, 'ensureRelay').mockRejectedValue(new Error(reason));
    await expect(
      querySyncAbortable(pool, [url], { kinds: [0] }, { rejectOnAllRelaysFailure: true }),
    ).rejects.toThrow('All relays failed to connect');
    pool.destroy();
  },
);

test('rejected AUTH promise rejects the read instead of succeeding empty', async () => {
  const pool = new TestPool();
  const relay = new AbstractRelay(url, { verifyEvent: (() => true) as never });
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(relay, 'auth').mockRejectedValue(new Error('auth timed out'));
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
  // A caller-provided AUTH signer travels through the real pool and transport.
  const authenticatedPool: Pick<SimplePool, 'subscribeMany'> = {
    subscribeMany: (urls, filter, params) =>
      pool.subscribeMany(urls, filter, { ...params, onauth: jest.fn() }),
  };
  const result = querySyncAbortable(
    authenticatedPool,
    [url],
    { kinds: [0] },
    { rejectOnAllRelaysFailure: true },
  );
  const assertion = expect(result).rejects.toThrow('All relays failed to connect');
  await Promise.resolve();
  const sub = [...relay.openSubs.values()][0];
  sub.close('auth-required: authenticate first');
  await assertion;
  expect(relay.auth).toHaveBeenCalledTimes(1);
  expect(relay.openSubs.size).toBe(0);
  pool.destroy();
});

beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }));
afterEach(() => jest.useRealTimers());
