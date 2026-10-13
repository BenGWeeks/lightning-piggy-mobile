import { AppState, type AppStateStatus } from 'react-native';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { subscribeMarmotRelays } from './marmotSubscription';
import { withResumableSubscriptions } from './resumablePool';

class TestPool extends withResumableSubscriptions(SimplePool) {}
let mockPool: TestPool;
jest.mock('./nostrPool', () => ({
  pool: {
    subscribeMany: (...args: Parameters<SimplePool['subscribeMany']>) =>
      mockPool.subscribeMany(...args),
    resetTransports: (relays: string[]) => mockPool.resetTransports(relays),
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

it('recovers Marmot and unrelated shared subscriptions after a silently dead socket on resume', async () => {
  jest.useFakeTimers();
  TestSocket.sockets = [];
  useWebSocketImplementation(TestSocket);
  mockPool = new TestPool();
  let onState!: (state: AppStateStatus) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, cb) => {
    onState = cb;
    return { remove: jest.fn() };
  });
  const next = jest.fn();
  const sub = subscribeMarmotRelays(['wss://relay.test'], [{ kinds: [445], limit: 500 }], next);
  const unrelatedNext = jest.fn();
  const unrelatedClose = jest.fn();
  const unrelated = mockPool.subscribeMany(
    ['wss://relay.test', 'wss://healthy.test'],
    { kinds: [20001], limit: 100 },
    { onevent: unrelatedNext, onclose: unrelatedClose, id: 'typing' },
  );
  try {
    await jest.advanceTimersByTimeAsync(0);
    const old = TestSocket.sockets[0];
    expect(old.subscriptions.size).toBe(2);
    onState('background');
    old.dead = true;
    onState('active');
    await jest.advanceTimersByTimeAsync(2_999);
    expect(TestSocket.sockets).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(TestSocket.sockets).toHaveLength(3);
    expect(old.readyState).toBe(3);
    const fresh = TestSocket.sockets[2];
    const event = finalizeEvent(
      { kind: 445, content: 'after resume', tags: [], created_at: 100 },
      generateSecretKey(),
    );
    fresh.onmessage?.({
      data: JSON.stringify([
        'EVENT',
        [...fresh.subscriptions].find((id) => id !== 'typing'),
        event,
      ]),
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ id: event.id, content: event.content });
    const typingEvent = finalizeEvent(
      { kind: 20001, content: '', tags: [], created_at: 101 },
      generateSecretKey(),
    );
    fresh.onmessage?.({ data: JSON.stringify(['EVENT', 'typing', typingEvent]) });
    await jest.advanceTimersByTimeAsync(0);
    expect(unrelatedNext).toHaveBeenCalledWith(expect.objectContaining({ id: typingEvent.id }));
    expect(unrelatedClose).not.toHaveBeenCalled();
    // The original handle still unsubscribes the restored fan-out, including
    // the healthy relay, and explicit IDs cannot be closed by old handles.
    unrelated.close();
    await jest.advanceTimersByTimeAsync(0);
    expect(fresh.subscriptions.has('typing')).toBe(false);
    expect(TestSocket.sockets[1].subscriptions.has('typing')).toBe(false);
  } finally {
    unrelated.close();
    sub.unsubscribe();
    mockPool.destroy();
    useWebSocketImplementation(global.WebSocket);
    listener.mockRestore();
    jest.useRealTimers();
  }
});
