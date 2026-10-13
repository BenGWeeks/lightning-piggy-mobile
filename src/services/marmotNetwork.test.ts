// The strict push transport's server-inbox (kind 10050) lookup. The pool is
// mocked: these tests never touch a real relay.
import type { Event } from 'nostr-tools';
import { AppState, type AppStateStatus } from 'react-native';
import { MarmotWelcomeOutbox } from './marmotWelcomeOutbox';
import { createMemoryMarmotBackend } from './marmotStore';
import {
  cleanPushRelays,
  createMarmotNetwork,
  createPushTransport,
  MAX_PUSH_INBOX_RELAYS,
  MAX_PUSH_RELAYS,
} from './marmotNetwork';
import { pool, trackRelays } from './nostrPool';
import { createMarmotGroupConnections } from './marmotGroupConnections';
import { onMarmotRelayReconnect } from './marmotRelayReconnect';
import { MARMOT_PUSH_SERVER_RELAYS } from './nostrRelayDefaults';

const mockQuerySync = jest.fn();
const mockPublish = jest.fn();
const mockSubscribeMany = jest.fn();
jest.mock('./nostrPool', () => ({
  pool: {
    querySync: (...args: unknown[]) => mockQuerySync(...args),
    publish: (...args: unknown[]) => mockPublish(...args),
    subscribeMany: (...args: unknown[]) => mockSubscribeMany(...args),
    close: jest.fn(),
  },
  trackRelays: jest.fn(),
}));

const SERVER = 'ee'.repeat(32);
const inboxEvent = (relays: string[], createdAt = 100) => ({
  kind: 10050,
  created_at: createdAt,
  tags: relays.map((r) => ['relay', r]),
});

beforeEach(() => {
  mockQuerySync.mockReset();
  jest.useRealTimers();
});

describe('createPushTransport().inboxRelays', () => {
  it("queries our push servers' relays first, bounded, and returns the newest 10050", async () => {
    mockQuerySync.mockResolvedValue([
      inboxEvent(['wss://old.example'], 50),
      inboxEvent(['wss://relay.ditto.pub', 'wss://relay.eu.whitenoise.chat'], 100),
    ]);
    const transport = createPushTransport(() => ['wss://user-read.example']);
    expect(await transport.inboxRelays(SERVER)).toEqual([
      'wss://relay.ditto.pub',
      'wss://relay.eu.whitenoise.chat',
    ]);
    const [relays, filter, opts] = mockQuerySync.mock.calls[0];
    expect(relays.slice(0, MARMOT_PUSH_SERVER_RELAYS.length)).toEqual(MARMOT_PUSH_SERVER_RELAYS);
    expect(relays).toEqual(
      expect.arrayContaining([
        'wss://relay.ditto.pub',
        'wss://relay.eu.whitenoise.chat',
        'wss://user-read.example',
      ]),
    );
    expect(filter).toEqual({ kinds: [10050], authors: [SERVER], limit: 1 });
    expect(opts.maxWait).toBeGreaterThan(0);
    // Tracked, so sign-out closes the lookup's sockets too.
    expect(trackRelays).toHaveBeenCalledWith(relays);
  });

  it('caches a found list, and shares one lookup between concurrent triggers', async () => {
    mockQuerySync.mockResolvedValue([inboxEvent(['wss://relay.ditto.pub'])]);
    const transport = createPushTransport(() => []);
    const [a, b] = await Promise.all([
      transport.inboxRelays(SERVER),
      transport.inboxRelays(SERVER),
    ]);
    expect(a).toEqual(['wss://relay.ditto.pub']);
    expect(b).toEqual(a);
    expect(await transport.inboxRelays(SERVER)).toEqual(a);
    expect(mockQuerySync).toHaveBeenCalledTimes(1);
  });

  it('re-asks after a miss only once the short miss window has passed', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    mockQuerySync.mockResolvedValueOnce([]);
    const transport = createPushTransport(() => []);
    expect(await transport.inboxRelays(SERVER)).toEqual([]);
    expect(await transport.inboxRelays(SERVER)).toEqual([]);
    expect(mockQuerySync).toHaveBeenCalledTimes(1);
    jest.setSystemTime(1_000_000 + 61_000);
    mockQuerySync.mockResolvedValueOnce([inboxEvent(['wss://relay.coinos.io'])]);
    expect(await transport.inboxRelays(SERVER)).toEqual(['wss://relay.coinos.io']);
    expect(mockQuerySync).toHaveBeenCalledTimes(2);
  });

  it('a failed lookup is not cached', async () => {
    mockQuerySync.mockRejectedValueOnce(new Error('offline'));
    const transport = createPushTransport(() => []);
    await expect(transport.inboxRelays(SERVER)).rejects.toThrow('offline');
    mockQuerySync.mockResolvedValueOnce([inboxEvent(['wss://relay.primal.net'])]);
    expect(await transport.inboxRelays(SERVER)).toEqual(['wss://relay.primal.net']);
  });
});

// #1338: push-trigger destinations come from other members' records and the
// push server's 10050 — connected to automatically, so only public wss://.
describe('push relay destination policy', () => {
  it('cleanPushRelays keeps public wss only, deduped and capped', () => {
    expect(
      cleanPushRelays([
        'wss://relay.ditto.pub',
        'ws://relay.ditto.pub',
        'ws://192.168.1.1/',
        'wss://10.0.0.1',
        'wss://127.1',
        'wss://user:pw@relay.example.com',
        'wss://printer.local',
        42,
        'wss://relay.ditto.pub',
        'wss://relay.primal.net',
      ]),
    ).toEqual(['wss://relay.ditto.pub', 'wss://relay.primal.net']);
    const many = Array.from({ length: MAX_PUSH_RELAYS + 4 }, (_, i) => `wss://r${i}.example.com`);
    expect(cleanPushRelays(many)).toHaveLength(MAX_PUSH_RELAYS);
  });

  it("drops private / plaintext relays from a push server's 10050, capped", async () => {
    const listed = [
      'ws://192.168.1.1/',
      'ws://plain.example.com',
      'wss://[::1]',
      ...Array.from({ length: MAX_PUSH_INBOX_RELAYS + 2 }, (_, i) => `wss://in${i}.example.com`),
    ];
    mockQuerySync.mockResolvedValue([inboxEvent(listed)]);
    const relays = await createPushTransport(() => []).inboxRelays(SERVER);
    expect(relays).toHaveLength(MAX_PUSH_INBOX_RELAYS);
    expect(relays.every((r) => r.startsWith('wss://in'))).toBe(true);
  });

  it('never publishes a trigger to a private or plaintext relay', async () => {
    const publish = mockPublish;
    publish.mockReset();
    publish.mockReturnValue([]);
    const transport = createPushTransport(() => []);
    await transport.publish(['ws://192.168.1.1/', 'wss://127.0.0.1'], {} as never);
    expect(publish).not.toHaveBeenCalled();
    await transport.publish(['ws://192.168.1.1/', 'wss://relay.ditto.pub'], {} as never);
    expect(publish).toHaveBeenCalledWith(['wss://relay.ditto.pub'], {});
  });
});

describe('createMarmotNetwork().publish', () => {
  const relays = ['wss://a.example', 'wss://b.example'];
  const event: Event = {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    sig: 'c'.repeat(128),
    created_at: 1,
    kind: 1059,
    tags: [['p', 'd'.repeat(64)]],
    content: '',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockPublish.mockReset();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reports connection failures as refused alongside real acknowledgements', async () => {
    mockPublish.mockReturnValue([
      Promise.resolve('connection failure: offline'),
      Promise.resolve(''),
    ]);
    const result = await createMarmotNetwork(() => []).publish(relays, event);
    expect(result[relays[0]]).toMatchObject({
      ok: false,
      message: expect.stringContaining('offline'),
    });
    expect(result[relays[1]]).toEqual({ from: relays[1], ok: true, message: '' });
  });

  it('keeps unreachable invitations queued through retries until a relay acknowledges', async () => {
    mockPublish.mockImplementation(() =>
      relays.map(() => Promise.resolve('connection failure: offline')),
    );
    const outbox = new MarmotWelcomeOutbox(createMemoryMarmotBackend());
    const network = outbox.wrapNetwork(createMarmotNetwork(() => []));
    const { failed } = await outbox.capture(() => network.publish(relays, event));
    expect(failed).toHaveLength(1);
    expect(await outbox.resend(failed)).toEqual(failed);
    await outbox.enqueue('group', failed);
    await outbox.flush();
    expect(await outbox.pending()).toHaveLength(1);
    mockPublish.mockReturnValue([
      Promise.resolve('connection failure: offline'),
      Promise.resolve('saved'),
    ]);
    await outbox.flush();
    expect(await outbox.pending()).toHaveLength(0);
  });
});

// Simulate Doze silently losing sockets and individual relay failures.
describe('Marmot subscription lifecycle', () => {
  let onState: (state: AppStateStatus) => void;
  let remove: jest.Mock;
  let close: jest.Mock;
  let stop: () => void;
  let next: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    remove = jest.fn();
    close = jest.fn();
    mockSubscribeMany.mockReset().mockReturnValue({ close });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, cb) => {
      onState = cb;
      return { remove };
    });
    next = jest.fn();
    const network = createMarmotNetwork(() => []);
    stop = network
      .subscription(['wss://one.example', 'wss://two.example'], {
        kinds: [445],
        '#h': ['group'],
        limit: 200,
        since: 100,
      })
      .subscribe({ next }).unsubscribe;
  });
  afterEach(() => {
    stop();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('dedupes events across relay routes and suppresses stale deliveries', () => {
    const event = { id: 'same-id' };
    const oldEvent = mockSubscribeMany.mock.calls[0][2].onevent;
    mockSubscribeMany.mock.calls[0][2].onevent(event);
    mockSubscribeMany.mock.calls[1][2].onevent(event);
    expect(next).toHaveBeenCalledTimes(1);
    onState('active');
    jest.advanceTimersByTime(3_000);
    oldEvent({ id: 'stale' });
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('reopens after silent background loss, staggered by three seconds', () => {
    const before = mockSubscribeMany.mock.calls.length;
    onState('background');
    jest.advanceTimersByTime(5 * 60_000);
    onState('active');
    expect(mockSubscribeMany).toHaveBeenCalledTimes(before);
    jest.advanceTimersByTime(3_000);
    expect(mockSubscribeMany.mock.calls.length).toBeGreaterThan(before);
    expect(close).toHaveBeenCalled();
    expect(mockSubscribeMany.mock.calls.at(-1)[1]).toEqual({
      kinds: [445],
      '#h': ['group'],
      limit: 200,
      since: 100,
    });
  });
  it('retries a failed relay even when another relay remains healthy', () => {
    const before = mockSubscribeMany.mock.calls.length;
    mockSubscribeMany.mock.calls[0][2].onclose(['connection closed']);
    jest.advanceTimersByTime(5_000);
    expect(mockSubscribeMany).toHaveBeenCalledTimes(before + 1);
    expect(mockSubscribeMany.mock.calls.at(-1)[0]).toEqual(['wss://one.example']);
  });
  it('replaces transports for every group before reconnect cancels sibling resume timers', () => {
    stop();
    jest.mocked(pool.close).mockClear();
    const network = createMarmotNetwork(
      () => [],
      () => connections.reconnect(),
    );
    const connections = createMarmotGroupConnections(() => {
      const subs = ['one', 'two'].map((group) =>
        network
          .subscription([`wss://${group}.example`], {
            kinds: [445],
            '#h': [group],
            limit: 500,
          })
          .subscribe({ next }),
      );
      return { unsubscribe: () => subs.forEach((sub) => sub.unsubscribe()) };
    });
    connections.start();
    stop = connections.unsubscribe;
    onState('active');
    jest.advanceTimersByTime(3_000);
    expect(pool.close).toHaveBeenCalledTimes(1);
    expect(pool.close).toHaveBeenCalledWith(['wss://one.example', 'wss://two.example']);
    expect(mockSubscribeMany.mock.calls.slice(-2).map(([relays]) => relays[0])).toEqual([
      'wss://one.example',
      'wss://two.example',
    ]);
  });
  it('hands relay retries to group catch-up, retaining backoff and recovery notifications across new routes', () => {
    stop();
    mockSubscribeMany.mockClear();
    let since = 100;
    const reconnect = jest.fn(() => {
      stop();
      since++;
      stop = arm();
    });
    const network = createMarmotNetwork(() => [], reconnect);
    const arm = () =>
      network
        .subscription(['wss://one.example'], {
          kinds: [445],
          '#h': ['group'],
          limit: 500,
          since,
        })
        .subscribe({ next }).unsubscribe;
    stop = arm();
    const recovered = jest.fn();
    const removeListener = onMarmotRelayReconnect(recovered);
    try {
      mockSubscribeMany.mock.calls[0][2].oneose();
      expect(recovered).not.toHaveBeenCalled();
      mockSubscribeMany.mock.calls[0][2].onclose(['offline']);
      jest.advanceTimersByTime(5_000);
      expect(reconnect).toHaveBeenCalledTimes(1);
      const reopened = mockSubscribeMany.mock.calls[1][2];
      reopened.oneose();
      reopened.oneose();
      expect(recovered).toHaveBeenCalledTimes(1);
      reopened.onclose(['still offline']);
      jest.advanceTimersByTime(9_999);
      expect(reconnect).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(reconnect).toHaveBeenCalledTimes(2);
    } finally {
      removeListener();
    }
  });
  it('notifies recovery once on replay or EOSE, ignoring initial and stale routes', () => {
    const recovered = jest.fn();
    const removeListener = onMarmotRelayReconnect(recovered);
    try {
      const initial = mockSubscribeMany.mock.calls[0][2];
      initial.oneose();
      expect(recovered).not.toHaveBeenCalled();
      initial.onclose(['offline']);
      jest.advanceTimersByTime(5_000);
      initial.oneose();
      expect(recovered).not.toHaveBeenCalled();
      const reopened = mockSubscribeMany.mock.calls.at(-1)[2];
      reopened.onevent({ id: 'replay' });
      reopened.oneose();
      expect(recovered).toHaveBeenCalledTimes(1);
      reopened.onclose(['offline again']);
      jest.advanceTimersByTime(5_000);
      mockSubscribeMany.mock.calls.at(-1)[2].oneose();
      expect(recovered).toHaveBeenCalledTimes(2);
    } finally {
      removeListener();
    }
  });
  it('ignores old close callbacks and cancels resume/retry work on unsubscribe', () => {
    const oldClose = mockSubscribeMany.mock.calls[0][2].onclose;
    onState('active');
    jest.advanceTimersByTime(3_000);
    const before = mockSubscribeMany.mock.calls.length;
    oldClose(['stale close']);
    jest.advanceTimersByTime(5_000);
    expect(mockSubscribeMany).toHaveBeenCalledTimes(before);
    mockSubscribeMany.mock.calls.at(-1)[2].onclose(['drop']);
    onState('active');
    stop();
    jest.advanceTimersByTime(10 * 60_000);
    expect(mockSubscribeMany).toHaveBeenCalledTimes(before);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('cancels queued resume work when backgrounded again', () => {
    const before = mockSubscribeMany.mock.calls.length;
    onState('active');
    onState('background');
    jest.advanceTimersByTime(10_000);
    expect(mockSubscribeMany).toHaveBeenCalledTimes(before);
  });
});
