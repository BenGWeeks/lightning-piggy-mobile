import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRelayOperator } from './useRelayOperator';
import * as cache from '../services/zapSenderProfileStorage';
import { pool } from '../services/nostrPool';
const PK = 'a'.repeat(64);
const mockInboxRelays: string[] = [];
let mockFocused = true;
const mockRelays = [{ url: 'wss://operator-relay.example', read: true }];
const mockClose = jest.fn();
let mockOnEvent: (event: { pubkey: string; content: string; created_at: number }) => void;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    const focused = mockFocused;
    React.useEffect(() => {
      if (focused) return callback();
    }, [callback, focused]);
  },
}));
jest.mock('../services/nostrPool', () => ({
  trackRelays: jest.fn(),
  pool: {
    subscribeManyEose: jest.fn((_relays, _filter, handlers) => {
      mockOnEvent = handlers.onevent;
      return { close: mockClose };
    }),
  },
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: mockRelays, dmInboxRelays: mockInboxRelays }),
}));
jest.mock('../services/zapSenderProfileStorage', () => ({
  get: jest.fn(),
  setMany: jest.fn(async () => {}),
}));
const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  (cache.get as jest.Mock).mockResolvedValue(null);
  global.fetch = mockFetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});
it('requests only the operator pubkey, then caches its display profile', async () => {
  const { result } = renderHook(() => useRelayOperator(PK));
  await waitFor(() => expect(pool.subscribeManyEose).toHaveBeenCalled());
  act(() =>
    mockOnEvent({ pubkey: PK, content: JSON.stringify({ name: 'Operator' }), created_at: 1 }),
  );
  await waitFor(() => expect(result.current.profile?.name).toBe('Operator'));
  expect(pool.subscribeManyEose).toHaveBeenCalledWith(
    expect.arrayContaining([mockRelays[0].url]),
    { kinds: [0], authors: [PK], limit: 1 },
    expect.anything(),
  );
  expect(cache.setMany).toHaveBeenCalledTimes(1);
});
it('uses a fresh cache hit and shows NIP-05 only when it resolves to the operator', async () => {
  (cache.get as jest.Mock).mockResolvedValue({
    name: 'Cached operator',
    nip05: 'operator@example.com',
  });
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ names: { operator: PK } }) });
  const { result } = renderHook(() => useRelayOperator(PK));
  await waitFor(() => expect(result.current.verifiedNip05).toBe('operator@example.com'));
  expect(pool.subscribeManyEose).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledWith(
    'https://example.com/.well-known/nostr.json?name=operator',
    expect.objectContaining({ signal: expect.anything() }),
  );
});
it('does not display a claimed NIP-05 mapped to a different key', async () => {
  (cache.get as jest.Mock).mockResolvedValue({ name: 'Operator', nip05: 'operator@example.com' });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ names: { operator: 'b'.repeat(64) } }),
  });
  const { result } = renderHook(() => useRelayOperator(PK));
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(result.current.verifiedNip05).toBeNull();
});
it('does not fetch when NIP-11 omits an operator', () => {
  renderHook(() => useRelayOperator(undefined));
  expect(pool.subscribeManyEose).not.toHaveBeenCalled();
  expect(cache.get).not.toHaveBeenCalled();
});

it('closes a pending operator subscription on blur, ignores late events and starts again on focus', async () => {
  const { result, rerender } = renderHook(() => useRelayOperator(PK));
  await waitFor(() => expect(pool.subscribeManyEose).toHaveBeenCalledTimes(1));
  mockFocused = false;
  rerender({});
  expect(mockClose).toHaveBeenCalledTimes(1);
  await act(async () => mockOnEvent({ pubkey: PK, content: '{"name":"Late"}', created_at: 1 }));
  expect(result.current.profile).toBeNull();
  expect(cache.setMany).not.toHaveBeenCalled();
  mockFocused = true;
  rerender({});
  await waitFor(() => expect(pool.subscribeManyEose).toHaveBeenCalledTimes(2));
});
it('does not start a subscription when a cache lookup completes after blur', async () => {
  let resolveCache!: (value: null) => void;
  (cache.get as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveCache = resolve;
    }),
  );
  const { rerender } = renderHook(() => useRelayOperator(PK));
  mockFocused = false;
  rerender({});
  await act(async () => resolveCache(null));
  expect(pool.subscribeManyEose).not.toHaveBeenCalled();
});
it('aborts pending NIP-05 verification on blur', async () => {
  (cache.get as jest.Mock).mockResolvedValue({ name: 'Operator', nip05: 'operator@example.com' });
  mockFetch.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const { result, rerender } = renderHook(() => useRelayOperator(PK));
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  mockFocused = false;
  rerender({});
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(result.current.verifiedNip05).toBeNull();
});
it('does no work while initially blurred', () => {
  mockFocused = false;
  renderHook(() => useRelayOperator(PK));
  expect(cache.get).not.toHaveBeenCalled();
  expect(pool.subscribeManyEose).not.toHaveBeenCalled();
});
