import { fetch as nativeFetch } from 'expo/fetch';

import { fetchPaymentVerification, isPaymentVerifyUrl } from './lnurlVerification';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

it.each([
  'http://wallet.example/verify',
  'https://127.0.0.1/verify',
  'https://10.0.0.1/verify',
  'https://wallet.local/verify',
  'https://user@wallet.example/verify',
  'https://2130706433/verify',
  undefined,
])('rejects unsafe verification URL %s', (url) => {
  expect(isPaymentVerifyUrl(url)).toBe(false);
});
it('accepts a public HTTPS URL', () => {
  expect(isPaymentVerifyUrl('https://wallet.example/verify/123')).toBe(true);
});

describe('verification request', () => {
  const fetchMock = jest.mocked(nativeFetch);
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('uses GET, refuses redirects and preserves the settled response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ settled: true, preimage: 'a'.repeat(64) }),
    } as Awaited<ReturnType<typeof nativeFetch>>);
    await expect(
      fetchPaymentVerification('https://wallet.example/verify', new AbortController().signal),
    ).resolves.toMatchObject({ settled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wallet.example/verify',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'timeout'])('aborts on %s and clears the request timer', async (reason) => {
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const controller = new AbortController();
    const result = fetchPaymentVerification('https://wallet.example/verify', controller.signal);
    const assertion = expect(result).rejects.toThrow('aborted');
    if (reason === 'cancel') controller.abort();
    else await jest.advanceTimersByTimeAsync(2500);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never fetches an unsafe URL', async () => {
    fetchMock.mockReset();
    expect(
      await fetchPaymentVerification('https://localhost/verify', new AbortController().signal),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Keep the unsafe RN global transport out of this security boundary. Native
// enforcement lives in Expo's native transport; this test guards our selection.
it('propagates a native redirect rejection without using XHR fetch', async () => {
  const unsafeXhrFetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ settled: true, preimage: 'a'.repeat(64) }),
  });
  const original = global.fetch;
  global.fetch = unsafeXhrFetch;
  jest.mocked(nativeFetch).mockRejectedValue(new Error('Redirect is not allowed'));
  try {
    await expect(
      fetchPaymentVerification(
        'https://wallet.example/redirect-to-private',
        new AbortController().signal,
      ),
    ).rejects.toThrow('Redirect is not allowed');
    expect(unsafeXhrFetch).not.toHaveBeenCalled();
  } finally {
    global.fetch = original;
  }
});
