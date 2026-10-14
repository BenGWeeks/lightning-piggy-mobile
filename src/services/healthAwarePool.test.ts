import { SimplePool } from 'nostr-tools/pool';
import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { withRelayHealth } from './healthAwarePool';
import { recordRelayPublish } from './relayHealth';
import { querySyncAbortable } from './relayQuery';
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { encrypt, getConversationKey } from 'nostr-tools/nip44';
import { withResumableSubscriptions } from './resumablePool';

jest.mock('./relayReqLimit', () => ({ discoverRelayReqLimit: async () => undefined }));

jest.mock('./relayHealth', () => ({
  RELAY_CONNECT_TIMEOUT_MS: 5000,
  RELAY_SKIPPED_REASON: 'relay skipped (unhealthy)',
  noteNetworkActivity: jest.fn(),
  recordRelayFailure: jest.fn(),
  recordRelaySuccess: jest.fn(),
  recordRelayConnectionObservation: jest.fn(),
  recordRelayPublish: jest.fn(),
  selectHealthyRelays: (relays: string[]) => relays,
}));

it('accepts an encrypted NIP-46 pairing ack through the health/resumable pool', async () => {
  jest.useFakeTimers();
  class PairingPool extends withResumableSubscriptions(withRelayHealth(SimplePool)) {}
  const pool = new PairingPool();
  const url = 'wss://pairing.example/';
  const relay = new AbstractRelay(url, { verifyEvent });
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
  // Relay switching is a later RPC; exercise the real encrypted pairing handler.
  const switchRelays = jest.spyOn(BunkerSigner.prototype, 'switchRelays').mockResolvedValue(false);
  const clientKey = generateSecretKey();
  const bunkerKey = generateSecretKey();
  const secret = 'pairing-secret';
  let signer: BunkerSigner | undefined;
  try {
    const pairing = BunkerSigner.fromURI(
      clientKey,
      createNostrConnectURI({
        clientPubkey: getPublicKey(clientKey),
        relays: [url],
        secret,
      }),
      { pool },
      60_000,
    );
    await jest.advanceTimersByTimeAsync(0);
    const pairingSub = [...relay.openSubs.values()][0];
    expect(pairingSub).toBeDefined();
    const ack = finalizeEvent(
      {
        kind: 24133,
        created_at: 100,
        tags: [['p', getPublicKey(clientKey)]],
        content: encrypt(
          JSON.stringify({ id: 'connect', result: secret }),
          getConversationKey(bunkerKey, getPublicKey(clientKey)),
        ),
      },
      bunkerKey,
    );
    const resolved = expect(pairing).resolves.toBeInstanceOf(BunkerSigner);
    pairingSub.onevent(ack);
    await jest.advanceTimersByTimeAsync(0);
    await resolved;
    signer = await pairing;
    expect(signer.bp.pubkey).toBe(getPublicKey(bunkerKey));
    expect(relay.openSubs.has(pairingSub.id)).toBe(false);
    expect(relay.openSubs.size).toBe(1); // Only the live signer subscription remains.
  } finally {
    await signer?.close();
    pool.destroy();
    relay.close();
    switchRelays.mockRestore();
    jest.useRealTimers();
  }
});

it('still rejects NIP-46 pairing when the subscription closes before an ack', async () => {
  jest.useFakeTimers();
  class PairingPool extends withResumableSubscriptions(withRelayHealth(SimplePool)) {}
  const pool = new PairingPool();
  const relay = new AbstractRelay('wss://pairing.example/', { verifyEvent });
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
  const clientKey = generateSecretKey();
  try {
    const pairing = BunkerSigner.fromURI(
      clientKey,
      createNostrConnectURI({
        clientPubkey: getPublicKey(clientKey),
        relays: [relay.url],
        secret: 'pairing-secret',
      }),
      { pool },
      60_000,
    );
    const rejected = expect(pairing).rejects.toThrow(
      'subscription closed before connection was established',
    );
    await jest.advanceTimersByTimeAsync(0);
    const pairingSub = [...relay.openSubs.values()][0];
    pairingSub.close('relay disconnected');
    await jest.advanceTimersByTimeAsync(0);
    await rejected;
    expect(relay.openSubs.size).toBe(0);
  } finally {
    pool.destroy();
    relay.close();
    jest.useRealTimers();
  }
});

// Stand-in for nostr-tools' pool: publish resolves per relay with whatever
// the test queues, exactly like SimplePool resolving "connection failure: …".
const queued: string[] = [];
class FakePool {
  publish(relays: string[]): Promise<string>[] {
    return relays.map((_, i) => Promise.resolve(queued[i] ?? ''));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mixin over a minimal fake base
const HealthAware = withRelayHealth(FakePool as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mixin returns an abstract class
const pool = new (HealthAware as any)();

const event = { id: 'e', pubkey: 'p', sig: 's', kind: 1, created_at: 1, tags: [], content: '' };

describe('withRelayHealth publish', () => {
  beforeEach(() => {
    queued.length = 0;
  });

  it('rejects a relay that nostr-tools resolved as a connection failure', async () => {
    queued.push('connection failure: timeout', '');
    const [failed, ok] = pool.publish(['wss://a.example', 'wss://b.example'], event);
    await expect(failed).rejects.toThrow('connection failure: timeout');
    await expect(ok).resolves.toBe('');
    expect(recordRelayPublish).toHaveBeenCalledWith(
      'wss://a.example',
      'p',
      false,
      expect.any(Error),
    );
    expect(recordRelayPublish).toHaveBeenCalledWith('wss://b.example', 'p', true);
  });

  it('makes Promise.any fail when every relay was unreachable', async () => {
    queued.push('connection failure: a', 'connection failure: b');
    await expect(
      Promise.any(pool.publish(['wss://a.example', 'wss://b.example'], event)),
    ).rejects.toBeInstanceOf(AggregateError);
  });
});

// Exercise the SDK's raw-message path: alreadyHaveEvent runs before JSON.parse
// and verification, whereas onevent runs only after those costs have been paid.
test.each(['subscribeMap', 'subscribeEose'] as const)(
  '%s shared dedup bypasses parsing and verification for duplicate relay deliveries',
  async (method) => {
    class TestPool extends withRelayHealth(SimplePool) {}
    const pool = new TestPool();
    const verifyEvent = jest.fn(() => true);
    const urls = ['wss://dedup-a.example/', 'wss://dedup-b.example/'];
    const relays = urls.map((url) => {
      const relay = new AbstractRelay(url, { verifyEvent: verifyEvent as never });
      jest.spyOn(relay, 'send').mockResolvedValue();
      return relay;
    });
    jest.spyOn(pool, 'ensureRelay').mockImplementation(async (url) => relays[urls.indexOf(url)]);
    const onevent = jest.fn();
    const alreadyHaveEvent = jest.fn((id: string) => id === 'f'.repeat(64));
    const subscription =
      method === 'subscribeMap'
        ? pool.subscribeMap(
            urls.map((url) => ({ url, filter: { kinds: [1] } })),
            { onevent, alreadyHaveEvent },
          )
        : pool.subscribeEose(urls, { kinds: [1] }, { onevent, alreadyHaveEvent });
    await Promise.resolve();
    await Promise.resolve();
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      kind: 1,
      created_at: 1,
      tags: [],
      content: '',
    };
    const parse = jest.spyOn(JSON, 'parse');
    try {
      for (const relay of [relays[0], relays[1], relays[0]]) {
        const sub = [...relay.openSubs.values()][0];
        relay._onmessage({ data: JSON.stringify(['EVENT', sub.id, event]) } as MessageEvent);
      }
      const sub = [...relays[1].openSubs.values()][0];
      relays[1]._onmessage({
        data: JSON.stringify(['EVENT', sub.id, { ...event, id: 'f'.repeat(64) }]),
      } as MessageEvent);
      expect(parse).toHaveBeenCalledTimes(1);
      expect(verifyEvent).toHaveBeenCalledTimes(1);
      expect(onevent).toHaveBeenCalledTimes(1);
      expect(alreadyHaveEvent).toHaveBeenCalledTimes(4);
    } finally {
      parse.mockRestore();
      subscription.close();
      pool.destroy();
    }
  },
);

beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }));
afterEach(() => jest.useRealTimers());

test('all connected sockets dropping before results rejects the read and releases budget slots', async () => {
  jest.useFakeTimers();
  class Socket {
    onopen?: () => void;
    onclose?: (event: { message?: string }) => void;
    send = jest.fn();
    close = jest.fn();
  }
  const sockets: Socket[] = [];
  class TestSocket extends Socket {
    constructor() {
      super();
      sockets.push(this);
    }
  }
  const urls = ['wss://drop-a.example/', 'wss://drop-b.example/'];
  const relays = urls.map(
    (url) =>
      new AbstractRelay(url, {
        verifyEvent: (() => true) as never,
        websocketImplementation: TestSocket as unknown as typeof WebSocket,
      }),
  );
  class ConnectedPool extends SimplePool {
    async ensureRelay(url: string) {
      return relays[urls.indexOf(url)];
    }
  }
  class TestPool extends withRelayHealth(ConnectedPool) {}
  const pool = new TestPool();
  try {
    const connections = relays.map((relay) => relay.connect());
    sockets.forEach((socket) => socket.onopen?.());
    await Promise.all(connections);
    expect(relays.every((relay) => relay.connected)).toBe(true);
    const result = querySyncAbortable(
      pool,
      urls,
      { kinds: [0] },
      {
        rejectOnAllRelaysFailure: true,
      },
    );
    const assertion = expect(result).rejects.toThrow('All relays failed to connect');
    await jest.advanceTimersByTimeAsync(0);
    expect(relays.map((relay) => relay.openSubs.size)).toEqual([1, 1]);
    sockets[0].onclose?.({});
    sockets[1].onclose?.({});
    await assertion;
    expect(relays.map((relay) => relay.openSubs.size)).toEqual([0, 0]);
    expect(relays.every((relay) => !relay.connected)).toBe(true);
  } finally {
    pool.destroy();
    relays.forEach((relay) => relay.close());
    jest.useRealTimers();
  }
});
