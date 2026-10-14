import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { setCurrentUserPubkey } from './nostrActiveAccount';
import { setRelayAuthAccount } from './relayAuth';
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
  Object.assign(relay, { challenge: 'test-challenge' });
  const secret = new Uint8Array(32).fill(2);
  setCurrentUserPubkey(getPublicKey(secret));
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(relay, 'auth').mockRejectedValue(new Error('auth timed out'));
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
  setRelayAuthAccount({
    pubkey: getPublicKey(secret),
    signerType: 'nsec',
    ownRelays: [],
    sign: async (event) => finalizeEvent(event, secret),
  });
  const result = querySyncAbortable(
    pool,
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
afterEach(() => {
  setRelayAuthAccount(null);
  setCurrentUserPubkey(null);
  jest.useRealTimers();
});

test.each(['query', 'raw subscription'])(
  'nsec auto-auth re-arms %s once and delivers events',
  async (path) => {
    const secret = new Uint8Array(32).fill(3);
    const pubkey = getPublicKey(secret);
    setCurrentUserPubkey(pubkey);
    const sign = jest.fn(async (event) => finalizeEvent(event, secret));
    setRelayAuthAccount({ pubkey, signerType: 'nsec', ownRelays: [], sign });
    const pool = new TestPool();
    const relay = new AbstractRelay(url, { verifyEvent: (() => true) as never });
    Object.assign(relay, { challenge: 'test-challenge' });
    const send = jest.spyOn(relay, 'send').mockImplementation(async (message) => {
      const [type, event] = JSON.parse(message);
      if (type === 'AUTH') {
        const state = relay as unknown as {
          openEventPublishes: Map<
            string,
            { resolve: (reason: string) => void; timeout: ReturnType<typeof setTimeout> }
          >;
        };
        const pending = state.openEventPublishes.get(event.id)!;
        clearTimeout(pending.timeout);
        pending.resolve('authenticated');
        state.openEventPublishes.delete(event.id);
      }
    });
    jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
    const event = finalizeEvent({ kind: 4, tags: [], content: 'DM', created_at: 1 }, secret);
    const received = jest.fn();
    const result =
      path === 'query'
        ? querySyncAbortable(pool, [url], { kinds: [4] }, {})
        : Promise.resolve(pool.subscribeRelay(relay, [{ kinds: [4] }], { onevent: received }, url));
    await Promise.resolve();
    [...relay.openSubs.values()][0].close('auth-required: authenticate first');
    // Flush signing, SDK AUTH/OK and transport continuation.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.filter(([message]) => message.startsWith('["REQ"'))).toHaveLength(2);
    const retried = [...relay.openSubs.values()][0];
    retried.onevent(event);
    retried.oneose?.();
    if (path === 'query') expect(await result).toEqual([event]);
    else expect(received).toHaveBeenCalledWith(event);
    pool.destroy();
  },
);

test('a repeated auth-required after successful AUTH terminates without looping', async () => {
  const secret = new Uint8Array(32).fill(4);
  const pubkey = getPublicKey(secret);
  setCurrentUserPubkey(pubkey);
  const sign = jest.fn(async (event) => finalizeEvent(event, secret));
  setRelayAuthAccount({ pubkey, signerType: 'nsec', ownRelays: [], sign });
  const pool = new TestPool();
  const relay = new AbstractRelay(url, { verifyEvent: (() => true) as never });
  Object.assign(relay, { challenge: 'test-challenge' });
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(relay, 'auth').mockResolvedValue('ok');
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
  const result = querySyncAbortable(
    pool,
    [url],
    { kinds: [4] },
    { rejectOnAllRelaysFailure: true },
  );
  const assertion = expect(result).rejects.toThrow('All relays failed');
  await Promise.resolve();
  [...relay.openSubs.values()][0].close('auth-required: first');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  [...relay.openSubs.values()][0].close('auth-required: again');
  await assertion;
  expect(sign).toHaveBeenCalledTimes(1);
  expect(relay.auth).toHaveBeenCalledTimes(1);
  pool.destroy();
});
