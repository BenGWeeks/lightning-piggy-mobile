import { bech32 } from 'bech32';
import { fetchInvoice, normalizeLnurlToUrl, resolveLnurlDirection } from './lnurlService';

// Encode an https URL as a bech32 `lnurl1…` string, mirroring the helper
// in lnurlWithdrawService.test.ts so both directions test the same form.
const encodeLnurl = (url: string): string => {
  const words = bech32.toWords(Buffer.from(url, 'utf8'));
  return bech32.encode('lnurl', words, 2000);
};

describe('normalizeLnurlToUrl', () => {
  it('strips the lightning: URI prefix', () => {
    const url = 'https://example.com/pay/abc';
    expect(normalizeLnurlToUrl(`lightning:${encodeLnurl(url)}`)).toBe(url);
  });

  it('decodes a bech32 lnurl1 string (any case)', () => {
    const url = 'https://example.com/pay/abc';
    expect(normalizeLnurlToUrl(encodeLnurl(url))).toBe(url);
    expect(normalizeLnurlToUrl(encodeLnurl(url).toUpperCase())).toBe(url);
  });

  it('rewrites cleartext lnurlp:// / lnurlw:// / lnurl:// to https://', () => {
    expect(normalizeLnurlToUrl('lnurlp://example.com/pay/abc')).toBe('https://example.com/pay/abc');
    expect(normalizeLnurlToUrl('lnurlw://example.com/w')).toBe('https://example.com/w');
    expect(normalizeLnurlToUrl('lnurl://example.com/x')).toBe('https://example.com/x');
  });

  it('passes a raw https URL through unchanged', () => {
    expect(normalizeLnurlToUrl('https://example.com/.well-known/lnurlp/alice')).toBe(
      'https://example.com/.well-known/lnurlp/alice',
    );
  });

  it('uses http:// for .onion cleartext hosts (LUD-17)', () => {
    expect(normalizeLnurlToUrl('lnurlw://abc123.onion/w')).toBe('http://abc123.onion/w');
    expect(normalizeLnurlToUrl('lnurlw://abc123.onion:8080/w')).toBe('http://abc123.onion:8080/w');
  });

  it('rejects a nested-scheme cleartext payload (no https://https://…)', () => {
    expect(() => normalizeLnurlToUrl('lnurl://https://evil.example.com/x')).toThrow(/malformed/i);
  });

  it('throws on an empty or unrecognised payload', () => {
    expect(() => normalizeLnurlToUrl('   ')).toThrow(/empty/i);
    expect(() => normalizeLnurlToUrl('not-an-lnurl')).toThrow(/not a recognised/i);
  });
});

describe('resolveLnurlDirection', () => {
  beforeEach(() => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });
  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it('reports kind "pay" for a payRequest, keyed off the resolved tag', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag: 'payRequest',
        callback: 'https://example.com/cb',
        minSendable: 1_000,
        maxSendable: 100_000,
        metadata: JSON.stringify([['text/plain', 'Pay me']]),
        commentAllowed: 120,
      }),
    });

    const result = await resolveLnurlDirection('lnurlp://example.com/pay/abc');
    expect(result.kind).toBe('pay');
    expect(result.tag).toBe('payRequest');
    expect(result.url).toBe('https://example.com/pay/abc');
    if (result.kind === 'pay') {
      expect(result.params.callback).toBe('https://example.com/cb');
      expect(result.params.minSats).toBe(1);
      expect(result.params.maxSats).toBe(100);
      expect(result.params.description).toBe('Pay me');
    }
  });

  it('reports kind "withdraw" for a withdrawRequest, so claim is not regressed', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag: 'withdrawRequest',
        callback: 'https://example.com/cb',
        k1: 'deadbeef',
        defaultDescription: '🐷 Piggy',
        minWithdrawable: 21_000,
        maxWithdrawable: 21_000,
      }),
    });

    const result = await resolveLnurlDirection('lnurlw://example.com/w');
    expect(result.kind).toBe('withdraw');
    expect(result.tag).toBe('withdrawRequest');
  });

  it('throws on an unsupported tag', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tag: 'channelRequest' }),
    });
    await expect(resolveLnurlDirection('lnurlp://example.com/x')).rejects.toThrow(
      /unsupported lnurl tag/i,
    );
  });

  it('throws on a non-OK endpoint response', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(resolveLnurlDirection('lnurlp://example.com/x')).rejects.toThrow(/502/);
  });
});

// Real bech32 + BOLT11 decoding, with a dummy signature: this gate validates
// amounts; signature verification remains the paying wallet's responsibility.
function invoiceWithAmount(hrp: string): string {
  const hashWords = bech32.toWords(Buffer.alloc(32, 1));
  return bech32.encode(
    hrp,
    [
      ...Array(7).fill(0), // timestamp
      1,
      1,
      20,
      ...hashWords, // payment_hash: 52 words
      ...Array(104).fill(0), // signature
    ],
    2000,
  );
}

describe('fetchInvoice amount authorization', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function returnInvoice(pr: unknown) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ pr }) });
  }

  it('accepts the exact requested amount and preserves zap/comment parameters', async () => {
    const invoice = invoiceWithAmount('lnbc1u'); // 100 sats
    returnInvoice(invoice);
    await expect(
      fetchInvoice('https://example.com/cb?token=abc', 100, {
        nostr: '{"kind":9734}',
        comment: 'hello',
      }),
    ).resolves.toBe(invoice);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('amount')).toBe('100000');
    expect(url.searchParams.get('token')).toBe('abc');
    expect(url.searchParams.get('nostr')).toBe('{"kind":9734}');
    expect(url.searchParams.get('comment')).toBe('hello');
  });

  it.each([
    ['higher amount', 'lnbc2u'],
    ['lower amount', 'lnbc500n'],
    ['sub-satoshi overcharge', 'lnbc1000010p'],
    ['amountless invoice', 'lnbc'],
    ['zero amount', 'lnbc0n'],
  ])('rejects a %s before handing the invoice to a caller', async (_, hrp) => {
    returnInvoice(invoiceWithAmount(hrp));
    await expect(fetchInvoice('https://example.com/cb', 100)).rejects.toThrow(/amount/);
  });

  it.each(['garbage', '', null, 123, {}])('rejects malformed invoice %p', async (pr) => {
    returnInvoice(pr);
    await expect(fetchInvoice('https://example.com/cb', 100)).rejects.toThrow();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    'rejects invalid requested amount %p without fetching',
    async (amount) => {
      await expect(fetchInvoice('https://example.com/cb', amount)).rejects.toThrow(/amount/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
