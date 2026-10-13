import {
  __resetRelayInformationForTests,
  fetchRelayInformation,
  parseRelayInformation,
  RELAY_INFORMATION_TTL_MS,
} from './relayInformation';

jest.mock('./relayHealth', () => ({
  relayKey: (url: string) => url.toLowerCase().replace(/\/+$/, ''),
}));
const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  __resetRelayInformationForTests();
  jest.useFakeTimers();
  global.fetch = mockFetch;
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ name: 'Example', limitation: { payment_required: false } }),
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('parses optional NIP-11 fields and ignores malformed values', () => {
  expect(
    parseRelayInformation({
      name: 'Relay',
      icon: 'javascript:bad',
      contact: 4,
      supported_nips: [1, 11, 11, -1, '42', 1.5],
      limitation: {
        payment_required: false,
        auth_required: 'yes',
        max_subscriptions: 0,
        max_message_length: -1,
        restricted_writes: true,
      },
    }),
  ).toEqual({
    name: 'Relay',
    supported_nips: [1, 11],
    limitation: { payment_required: false, max_subscriptions: 0, restricted_writes: true },
  });
  expect(parseRelayInformation({ icon: 'https://example.com/icon.png', version: '1' })).toEqual({
    icon: 'https://example.com/icon.png',
    version: '1',
    limitation: {},
  });
  expect(() => parseRelayInformation([])).toThrow();
  expect(() => parseRelayInformation(null)).toThrow();
});

it('shares concurrent requests and caches normalised URLs until expiry', async () => {
  const first = fetchRelayInformation('wss://EXAMPLE.com/');
  expect(fetchRelayInformation('wss://example.com')).toBe(first);
  await expect(first).resolves.toMatchObject({ name: 'Example' });
  expect(mockFetch).toHaveBeenCalledWith(
    'https://example.com/',
    expect.objectContaining({
      headers: { Accept: 'application/nostr+json' },
      signal: expect.anything(),
    }),
  );
  await fetchRelayInformation('wss://example.com');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(RELAY_INFORMATION_TTL_MS + 1);
  await fetchRelayInformation('wss://example.com');
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('caches failures briefly, then retries without claiming information exists', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  await expect(fetchRelayInformation('wss://example.com')).resolves.toBeNull();
  await fetchRelayInformation('wss://example.com');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60_001);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  await expect(fetchRelayInformation('wss://example.com')).resolves.toEqual({ limitation: {} });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('handles non-OK responses and malformed JSON', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false });
  await expect(fetchRelayInformation('wss://example.com')).resolves.toBeNull();
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
  await expect(fetchRelayInformation('ws://other.example')).resolves.toBeNull();
});

it('aborts the HTTP request after five seconds', async () => {
  mockFetch.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const request = fetchRelayInformation('wss://example.com');
  jest.advanceTimersByTime(5000);
  await expect(request).resolves.toBeNull();
});
