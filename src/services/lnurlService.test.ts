import { bech32 } from 'bech32';
import { normalizeLnurlToUrl, resolveLnurlDirection } from './lnurlService';

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
