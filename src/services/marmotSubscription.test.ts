import { AppState, type AppStateStatus } from 'react-native';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { subscribeMarmotRelays } from './marmotSubscription';

let mockPool: SimplePool;
jest.mock('./nostrPool', () => ({
  pool: {
    subscribeMany: (...args: Parameters<SimplePool['subscribeMany']>) =>
      mockPool.subscribeMany(...args),
    close: (relays: string[]) => mockPool.close(relays),
  },
}));

// The real SimplePool/AbstractRelay, over a socket that can go silently deaf
// while still reporting OPEN (the Doze scenario). No network traffic.
class TestSocket {
  static OPEN = 1;
  static sockets: TestSocket[] = [];
  readyState = TestSocket.OPEN;
  dead = false;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { message: string }) => void;
  subscriptions = new Set<string>();
  constructor() {
    TestSocket.sockets.push(this);
    void Promise.resolve().then(() => this.onopen?.());
  }
  send(raw: string) {
    if (this.dead) return;
    const [type, id] = JSON.parse(raw) as string[];
    if (type === 'REQ') {
      this.subscriptions.add(id);
      void Promise.resolve().then(() => this.onmessage?.({ data: JSON.stringify(['EOSE', id]) }));
    } else if (type === 'CLOSE') this.subscriptions.delete(id);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ message: 'closed' });
  }
}

it('replaces a silently dead cached SimplePool socket on resume and receives new events', async () => {
  jest.useFakeTimers();
  TestSocket.sockets = [];
  useWebSocketImplementation(TestSocket);
  mockPool = new SimplePool();
  let onState!: (state: AppStateStatus) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, cb) => {
    onState = cb;
    return { remove: jest.fn() };
  });
  const next = jest.fn();
  const sub = subscribeMarmotRelays(['wss://relay.test'], [{ kinds: [445], limit: 500 }], next);
  try {
    await jest.advanceTimersByTimeAsync(0);
    const old = TestSocket.sockets[0];
    expect(old.subscriptions.size).toBe(1);
    onState('background');
    old.dead = true;
    onState('active');
    await jest.advanceTimersByTimeAsync(2_999);
    expect(TestSocket.sockets).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(TestSocket.sockets).toHaveLength(2);
    expect(old.readyState).toBe(3);
    const fresh = TestSocket.sockets[1];
    const event = finalizeEvent(
      { kind: 445, content: 'after resume', tags: [], created_at: 100 },
      generateSecretKey(),
    );
    fresh.onmessage?.({
      data: JSON.stringify(['EVENT', [...fresh.subscriptions][0], event]),
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ id: event.id, content: event.content });
  } finally {
    sub.unsubscribe();
    mockPool.destroy();
    useWebSocketImplementation(global.WebSocket);
    listener.mockRestore();
    jest.useRealTimers();
  }
});
