import { setCurrentUserPubkey } from '../services/nostrActiveAccount';
import { TEST_ACCOUNT_KEYS } from '../utils/testAccounts';
import { TEST_RELAY_URL } from '../config/testRelayLockdown';
import { act, renderHook } from '@testing-library/react-native';
import { useRelayReachability } from './useRelayReachability';
import { reachabilityCache } from '../services/relayReachabilityProbe';

let mockFocused = true;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    const focused = mockFocused;
    React.useEffect(() => {
      if (focused) return callback();
    }, [callback, focused]);
  },
}));
class MockSocket {
  static instances: MockSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
}
const originalSocket = global.WebSocket;
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
};
beforeEach(() => {
  mockFocused = true;
  jest.useFakeTimers();
  reachabilityCache.clear();
  MockSocket.instances = [];
  global.WebSocket = MockSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  setCurrentUserPubkey(null);
  global.WebSocket = originalSocket;
  jest.useRealTimers();
});

it('sends a bounded REQ, batches results and limits all active probes to three', async () => {
  const { result, unmount } = renderHook(() =>
    useRelayReachability(['wss://a', 'wss://b', 'wss://c', 'wss://d']),
  );
  expect(MockSocket.instances).toHaveLength(3);
  MockSocket.instances[0].onopen?.();
  expect(JSON.parse(MockSocket.instances[0].send.mock.calls[0][0])[2]).toMatchObject({
    limit: 1,
    kinds: [0],
    since: expect.any(Number),
  });
  MockSocket.instances[0].onmessage?.();
  await flush();
  expect(MockSocket.instances).toHaveLength(4);
  expect(result.current.size).toBe(0);
  MockSocket.instances.slice(1).forEach((socket) => socket.onmessage?.());
  await flush();
  expect(result.current.size).toBe(4);
  expect(MockSocket.instances.every((socket) => socket.close.mock.calls.length === 1)).toBe(true);
  unmount();
});
it('times out after six seconds and refreshes at 30 seconds despite cached results', async () => {
  const { result, unmount } = renderHook(() => useRelayReachability(['wss://a']));
  act(() => jest.advanceTimersByTime(6000));
  await flush();
  expect(result.current.get('wss://a')?.error).toBe('timeout');
  act(() => jest.advanceTimersByTime(24000));
  await flush();
  expect(MockSocket.instances).toHaveLength(2);
  MockSocket.instances[1].onmessage?.();
  await flush();
  expect(result.current.get('wss://a')?.reachable).toBe(true);
  unmount();
});
it('uses the cache on focus, probes added entries and cancels sockets and queue on blur', async () => {
  reachabilityCache.set('wss://cached', { reachable: true, checkedAt: Date.now() });
  const { result, rerender, unmount } = renderHook(
    ({ urls }: { urls: string[] }) => useRelayReachability(urls),
    {
      initialProps: { urls: ['wss://cached'] },
    },
  );
  await flush();
  expect(MockSocket.instances).toHaveLength(0);
  expect(result.current.get('wss://cached')?.reachable).toBe(true);
  rerender({ urls: ['wss://cached', 'wss://a', 'wss://b', 'wss://c', 'wss://d'] });
  expect(MockSocket.instances).toHaveLength(3);
  unmount();
  await flush();
  expect(MockSocket.instances.every((socket) => socket.close.mock.calls.length === 1)).toBe(true);
  act(() => jest.advanceTimersByTime(60_000));
  await flush();
  expect(MockSocket.instances).toHaveLength(3);
  expect(reachabilityCache.get('wss://a')).toBeUndefined();
});
it('summarises TLS and connection-close failures', async () => {
  const { result, unmount } = renderHook(() => useRelayReachability(['wss://tls', 'wss://closed']));
  MockSocket.instances
    .find((s) => s.url === 'wss://tls')!
    .onerror?.({ message: 'SSL certificate error' });
  MockSocket.instances.find((s) => s.url === 'wss://closed')!.onclose?.();
  await flush();
  expect(result.current.get('wss://tls')?.error).toBe('tls');
  expect(result.current.get('wss://closed')?.error).toBe('closed');
  unmount();
});
it('probes HTTPS roots with HEAD and falls back to GET', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ status: 405 })
    .mockResolvedValueOnce({ status: 200 });
  global.fetch = fetchMock;
  const { result, unmount } = renderHook(() =>
    useRelayReachability(['https://blossom.example/path'], 'blossom'),
  );
  await flush();
  expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
    ['https://blossom.example/', 'HEAD'],
    ['https://blossom.example/', 'GET'],
  ]);
  expect(result.current.get('https://blossom.example/path')?.reachable).toBe(true);
  unmount();
  global.fetch = originalFetch;
});

it('cancels on blur and reuses fresh results on refocus', async () => {
  const { result, rerender, unmount } = renderHook(() =>
    useRelayReachability(['wss://a', 'wss://b']),
  );
  MockSocket.instances[0].onmessage?.();
  await flush();
  mockFocused = false;
  rerender({});
  await flush();
  expect(MockSocket.instances[1].close).toHaveBeenCalledTimes(1);
  expect(result.current.size).toBe(0); // Cancelled round never flushes partial results.
  act(() => jest.advanceTimersByTime(30_000));
  await flush();
  expect(MockSocket.instances).toHaveLength(2);
  mockFocused = true;
  rerender({});
  await flush();
  expect(result.current.get('wss://a')?.reachable).toBe(true);
  expect(MockSocket.instances).toHaveLength(3); // Only the unfinished URL is re-probed.
  unmount();
});
it('shares the concurrency budget between separate list hooks', async () => {
  const first = renderHook(() => useRelayReachability(['wss://a', 'wss://b']));
  const second = renderHook(() => useRelayReachability(['wss://c', 'wss://d']));
  expect(MockSocket.instances).toHaveLength(3);
  MockSocket.instances[0].onmessage?.();
  await flush();
  expect(MockSocket.instances).toHaveLength(4);
  first.unmount();
  second.unmount();
  await flush();
});
it('times out and aborts a stalled HTTPS request', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  global.fetch = fetchMock as typeof fetch;
  const { result, unmount } = renderHook(() =>
    useRelayReachability(['https://blossom.example'], 'blossom'),
  );
  act(() => jest.advanceTimersByTime(6000));
  await flush();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(result.current.get('https://blossom.example')?.error).toBe('timeout');
  unmount();
  global.fetch = originalFetch;
});

it('routes HTTPS relay probes to LAN while retaining Blossom HTTP traffic', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({ status: 200 });
  global.fetch = fetchMock;
  setCurrentUserPubkey(TEST_ACCOUNT_KEYS.big);
  const relay = renderHook(() => useRelayReachability(['https://relay.example']));
  const blossom = renderHook(() => useRelayReachability(['https://blossom.example'], 'blossom'));
  try {
    await flush();
    expect(MockSocket.instances[0].url).toBe(TEST_RELAY_URL);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['https://blossom.example/']);
  } finally {
    relay.unmount();
    blossom.unmount();
    global.fetch = originalFetch;
  }
});

it('aborts an in-flight HTTPS relay probe when switching into lockdown', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  global.fetch = fetchMock as typeof fetch;
  const relay = renderHook(() => useRelayReachability(['https://relay.example']));
  try {
    await flush();
    act(() => setCurrentUserPubkey(TEST_ACCOUNT_KEYS.big));
    await flush();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  } finally {
    relay.unmount();
    global.fetch = originalFetch;
  }
});
