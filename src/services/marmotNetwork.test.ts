// The strict push transport's server-inbox (kind 10050) lookup. The pool is
// mocked: these tests never touch a real relay.
const mockQuerySync = jest.fn();
const mockPublish = jest.fn();
jest.mock('./nostrPool', () => ({
  pool: {
    querySync: (...args: unknown[]) => mockQuerySync(...args),
    publish: (...args: unknown[]) => mockPublish(...args),
  },
  trackRelays: jest.fn(),
}));

import type { Event } from 'nostr-tools';
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
import { MARMOT_PUSH_SERVER_RELAYS } from './nostrRelayDefaults';

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
    const publish = pool.publish as unknown as jest.Mock;
    publish.mockClear();
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
