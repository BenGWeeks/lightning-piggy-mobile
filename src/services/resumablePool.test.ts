import {
  SimplePool,
  useWebSocketImplementation as setWebSocketImplementation,
} from 'nostr-tools/pool';
import { performance as hostPerformance } from 'perf_hooks';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { withResumableSubscriptions } from './resumablePool';

class TestPool extends withResumableSubscriptions(SimplePool) {}

it('honours unsubscribe during a pending reset and suppresses old callbacks', async () => {
  let finishClose!: () => void;
  const pendingClose = new Promise<void>((resolve) => (finishClose = resolve));
  const close = jest.fn(() => pendingClose);
  const subscribe = jest.spyOn(SimplePool.prototype, 'subscribeMap').mockReturnValue({ close });
  const closeTransport = jest.spyOn(SimplePool.prototype, 'close').mockImplementation(() => {});
  const pool = new TestPool();
  const next = jest.fn();
  const onclose = jest.fn();
  const oneose = jest.fn();
  try {
    const sub = pool.subscribeMany(
      ['wss://RELAY.test:443'],
      { kinds: [1], limit: 1 },
      {
        onevent: next,
        onclose,
        oneose,
      },
    );
    const params = subscribe.mock.calls[0][1];
    const reset = pool.resetTransports(['wss://relay.test/']);
    params.onevent?.({ id: 'old' } as never);
    params.oneose?.();
    params.onclose?.(['intentional close']);
    expect(next).not.toHaveBeenCalled();
    expect(oneose).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
    sub.close();
    finishClose();
    await reset;
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalledWith(['wss://relay.test/']);
  } finally {
    pool.destroy();
    subscribe.mockRestore();
    closeTransport.mockRestore();
  }
});

// Exercise the real SimplePool while a socket connection holds close() pending.
class PendingSocket {
  static OPEN = 1;
  static sockets: PendingSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { message: string }) => void;
  subscriptions = new Set<string>();
  messages: unknown[][] = [];
  constructor() {
    PendingSocket.sockets.push(this);
  }
  open() {
    this.readyState = PendingSocket.OPEN;
    this.onopen?.();
  }
  send(raw: string) {
    const message = JSON.parse(raw) as string[];
    this.messages.push(message);
    const [type, id] = message;
    if (type === 'REQ') this.subscriptions.add(id);
    else if (type === 'CLOSE') this.subscriptions.delete(id);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ message: 'closed' });
  }
}

it.each([false, true])(
  'protects a subscription created during pending transport replacement (cancelled: %s)',
  async (cancelled) => {
    jest.useFakeTimers();
    PendingSocket.sockets = [];
    setWebSocketImplementation(PendingSocket);
    const pool = new TestPool();
    const original = pool.subscribeMany(
      ['wss://relay.test'],
      { kinds: [445], limit: 500 },
      { id: 'marmot' },
    );
    const reset = pool.resetTransports(['wss://relay.test']);
    const next = jest.fn();
    const onclose = jest.fn();
    const oneose = jest.fn();
    const late = pool.subscribeMany(
      ['wss://RELAY.test:443'],
      { kinds: [20001], limit: 100 },
      { id: 'typing', onevent: next, onclose, oneose },
    );
    try {
      if (cancelled) await late.close();
      PendingSocket.sockets[0].open();
      await reset;
      expect(PendingSocket.sockets).toHaveLength(2);
      const fresh = PendingSocket.sockets[1];
      fresh.open();
      await jest.advanceTimersByTimeAsync(0);
      expect(fresh.subscriptions.has('typing')).toBe(!cancelled);
      expect(onclose).not.toHaveBeenCalled();
      if (!cancelled) {
        const event = finalizeEvent(
          { kind: 20001, content: '', tags: [], created_at: 100 },
          generateSecretKey(),
        );
        fresh.onmessage?.({ data: JSON.stringify(['EVENT', 'typing', event]) });
        fresh.onmessage?.({ data: JSON.stringify(['EOSE', 'typing']) });
        await jest.advanceTimersByTimeAsync(0);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }));
        expect(oneose).toHaveBeenCalledTimes(1);
        await late.close();
        expect(fresh.subscriptions.has('typing')).toBe(false);
      }
    } finally {
      PendingSocket.sockets.forEach((socket) => {
        if (socket.readyState === 0) socket.open();
      });
      await Promise.all([original.close(), late.close()]);
      pool.destroy();
      setWebSocketImplementation(global.WebSocket);
      jest.useRealTimers();
    }
  },
);

it.each([
  'EVENT',
  'AUTH',
  'COUNT',
  'AUTH signing',
  'publish connecting',
  'AUTH retry',
  'publish timeout',
  'COUNT teardown',
  'COUNT close',
])('preserves pending %s across transport replacement', async (scenario) => {
  jest.useFakeTimers();
  PendingSocket.sockets = [];
  setWebSocketImplementation(PendingSocket);
  const pool = new TestPool();
  const url = 'wss://relay.test';
  const event = finalizeEvent(
    { kind: 1, content: 'pending send', tags: [], created_at: 100 },
    generateSecretKey(),
  );
  const connecting = pool.ensureRelay(url);
  const old = PendingSocket.sockets[0];
  let operation: Promise<unknown>;
  if (scenario === 'publish connecting') {
    operation = pool.publish([url], event)[0];
  } else {
    old.open();
    await connecting;
    const relay = await pool.ensureRelay(url);
    relay.publishTimeout = 100;
    if (scenario.startsWith('COUNT')) {
      operation = relay.count([{ kinds: [1], limit: 10 }], { id: 'count' });
    } else if (scenario === 'AUTH' || scenario === 'AUTH signing') {
      old.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge']) });
      await jest.advanceTimersByTimeAsync(0);
      let finishSigning!: (signed: typeof event) => void;
      const signed = new Promise<typeof event>((resolve) => (finishSigning = resolve));
      operation = relay.auth(() => (scenario === 'AUTH signing' ? signed : Promise.resolve(event)));
      if (scenario === 'AUTH signing') {
        // Reset while the signer has not yet registered an OK waiter.
        await pool.resetTransports([url]);
        expect(old.readyState).toBe(PendingSocket.OPEN);
        finishSigning(event);
      }
    } else {
      operation = pool.publish([url], event, {
        onauth: async () => event,
      })[0];
    }
  }
  // Attach rejection handling immediately (timeouts/teardown intentionally reject).
  const outcome = operation.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    await jest.advanceTimersByTimeAsync(0);
    await pool.resetTransports([url]);
    if (scenario === 'publish connecting') old.open();
    await connecting;
    await jest.advanceTimersByTimeAsync(0);
    expect(old.readyState).toBe(PendingSocket.OPEN);
    const freshConnecting = pool.ensureRelay(url);
    const fresh = PendingSocket.sockets[PendingSocket.sockets.length - 1];
    expect(fresh).not.toBe(old);
    fresh.open();
    const freshRelay = await freshConnecting;
    if (scenario === 'AUTH retry') {
      old.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge']) });
      old.onmessage?.({
        data: JSON.stringify(['OK', event.id, false, 'auth-required: authenticate']),
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(old.readyState).toBe(PendingSocket.OPEN);
      expect(old.messages.some(([type]) => type === 'AUTH')).toBe(true);
      old.onmessage?.({ data: JSON.stringify(['OK', event.id, true, 'authenticated']) });
      await jest.advanceTimersByTimeAsync(0);
      expect(old.readyState).toBe(PendingSocket.OPEN);
    }
    if (scenario === 'publish timeout') {
      await jest.advanceTimersByTimeAsync(100);
      expect(await outcome).toEqual({
        error: expect.objectContaining({ message: 'publish timed out' }),
      });
    } else if (scenario === 'COUNT teardown' || scenario === 'COUNT close') {
      if (scenario === 'COUNT close') pool.close([url]);
      else pool.destroy();
      expect(await outcome).toEqual({
        error: expect.objectContaining({ message: 'relay connection closed by us' }),
      });
    } else {
      old.onmessage?.({
        data: JSON.stringify(
          scenario === 'COUNT'
            ? ['COUNT', 'count', { count: 42 }]
            : ['OK', event.id, true, 'saved'],
        ),
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(await outcome).toEqual({ value: scenario === 'COUNT' ? 42 : 'saved' });
    }
    expect(old.readyState).toBe(3);
    if (scenario !== 'COUNT teardown' && scenario !== 'COUNT close')
      expect(await pool.ensureRelay(url)).toBe(freshRelay);
  } finally {
    pool.destroy();
    setWebSocketImplementation(global.WebSocket);
    jest.useRealTimers();
  }
});

it.each([1, 10, 50])('measures restoring %i groups across shared transports', async (groups) => {
  if (!process.env.MARMOT_POOL_PERF_SAMPLES) return;
  const samples: number[] = [];
  for (let sample = 0; sample < Number(process.env.MARMOT_POOL_PERF_SAMPLES); sample++) {
    PendingSocket.sockets = [];
    setWebSocketImplementation(PendingSocket);
    const pool = new TestPool();
    const urls = Array.from({ length: Math.min(groups, 3) }, (_, i) => `wss://relay-${i}.test`);
    const closers: ReturnType<TestPool['subscribeMany']>[] = [];
    const flush = async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    };
    try {
      const connecting = urls.map((url) => pool.ensureRelay(url));
      PendingSocket.sockets.forEach((socket) => socket.open());
      await Promise.all(connecting);
      for (let i = 0; i < groups; i++) {
        closers.push(
          pool.subscribeMany(
            [urls[i % urls.length]],
            { kinds: [445], limit: 500 },
            { id: `group-${i}` },
          ),
        );
      }
      await flush();
      const startedAt = hostPerformance.now();
      await pool.resetTransports(urls);
      PendingSocket.sockets
        .filter((socket) => socket.readyState === 0)
        .forEach((socket) => socket.open());
      await flush();
      samples.push(hostPerformance.now() - startedAt);
      expect(
        PendingSocket.sockets
          .filter((socket) => socket.readyState === 1)
          .reduce((sum, socket) => sum + socket.subscriptions.size, 0),
      ).toBe(groups);
    } finally {
      await Promise.all(closers.map((closer) => closer.close()));
      pool.destroy();
      setWebSocketImplementation(global.WebSocket);
    }
  }
  samples.sort((a, b) => a - b);
  const percentile = (p: number) => samples[Math.ceil(samples.length * p) - 1].toFixed(3);
  process.stdout.write(
    `[PerfBlock] marmotTransportRestore groups=${groups} relays=${Math.min(groups, 3)} n=${samples.length} p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms\n`,
  );
});
