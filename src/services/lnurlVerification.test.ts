import { fetchPaymentVerification, isPaymentVerifyUrl } from './lnurlVerification';

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
  const originalFetch = global.fetch;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('uses GET, refuses redirects and preserves the settled response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settled: true, preimage: 'a'.repeat(64) }),
    });
    await expect(
      fetchPaymentVerification('https://wallet.example/verify', new AbortController().signal),
    ).resolves.toMatchObject({ settled: true });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://wallet.example/verify',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'timeout'])('aborts on %s and clears the request timer', async (reason) => {
    global.fetch = jest.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as typeof fetch;
    const controller = new AbortController();
    const result = fetchPaymentVerification('https://wallet.example/verify', controller.signal);
    const assertion = expect(result).rejects.toThrow('aborted');
    if (reason === 'cancel') controller.abort();
    else await jest.advanceTimersByTimeAsync(2500);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never fetches an unsafe URL', async () => {
    global.fetch = jest.fn();
    expect(
      await fetchPaymentVerification('https://localhost/verify', new AbortController().signal),
    ).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
