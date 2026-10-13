import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
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
  constructor() {
    PendingSocket.sockets.push(this);
  }
  open() {
    this.readyState = PendingSocket.OPEN;
    this.onopen?.();
  }
  send(raw: string) {
    const [type, id] = JSON.parse(raw) as string[];
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
    useWebSocketImplementation(PendingSocket);
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
      useWebSocketImplementation(global.WebSocket);
      jest.useRealTimers();
    }
  },
);
