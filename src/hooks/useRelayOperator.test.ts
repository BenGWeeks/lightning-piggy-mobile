import { renderHook, waitFor } from '@testing-library/react-native';
import { useRelayOperator } from './useRelayOperator';
import * as cache from '../services/zapSenderProfileStorage';
const PK = 'a'.repeat(64);
const mockBatch = jest.fn();
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ fetchProfilesForPubkeys: mockBatch }),
}));
jest.mock('../services/zapSenderProfileStorage', () => ({
  get: jest.fn(),
  setMany: jest.fn(async () => {}),
}));
const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (cache.get as jest.Mock).mockResolvedValue(null);
  global.fetch = mockFetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});
it('requests only the operator pubkey, then caches its display profile', async () => {
  mockBatch.mockResolvedValue(new Map([[PK, { pubkey: PK, name: 'Operator', nip05: null }]]));
  const { result } = renderHook(() => useRelayOperator(PK));
  await waitFor(() => expect(result.current.profile?.name).toBe('Operator'));
  expect(mockBatch).toHaveBeenCalledWith([PK]);
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
  expect(mockBatch).not.toHaveBeenCalled();
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
  expect(mockBatch).not.toHaveBeenCalled();
  expect(cache.get).not.toHaveBeenCalled();
});
