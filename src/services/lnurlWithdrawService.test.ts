import { bech32 } from 'bech32';
import {
  decodeLnurlWithdraw,
  LnurlWithdrawError,
  msatToSats,
  resolveLnurlWithdraw,
} from './lnurlWithdrawService';

const encodeLnurl = (url: string): string => {
  const bytes = new TextEncoder().encode(url);
  const words = bech32.toWords(Array.from(bytes));
  return bech32.encode('lnurl', words, 2_000);
};

describe('decodeLnurlWithdraw', () => {
  it('decodes a bech32 lnurl1 string', () => {
    const url = 'https://example.com/api/withdraw/abc';
    expect(decodeLnurlWithdraw(encodeLnurl(url))).toBe(url);
  });

  it('accepts uppercase bech32 (LNURL1…)', () => {
    const url = 'https://example.com/api/withdraw/abc';
    expect(decodeLnurlWithdraw(encodeLnurl(url).toUpperCase())).toBe(url);
  });

  it('strips a `lightning:` URI prefix', () => {
    const url = 'https://example.com/withdraw';
    expect(decodeLnurlWithdraw(`lightning:${encodeLnurl(url).toUpperCase()}`)).toBe(url);
  });

  it('handles a `lnurlw://` cleartext URI', () => {
    expect(decodeLnurlWithdraw('lnurlw://example.com/withdraw/abc')).toBe(
      'https://example.com/withdraw/abc',
    );
  });

  it('passes through a raw https URL', () => {
    expect(decodeLnurlWithdraw('https://example.com/withdraw/abc')).toBe(
      'https://example.com/withdraw/abc',
    );
  });

  it('throws on empty input', () => {
    expect(() => decodeLnurlWithdraw('')).toThrow(LnurlWithdrawError);
    expect(() => decodeLnurlWithdraw('   ')).toThrow(LnurlWithdrawError);
  });

  it('throws on a non-LNURL string', () => {
    expect(() => decodeLnurlWithdraw('not-an-lnurl')).toThrow(LnurlWithdrawError);
  });
});

describe('resolveLnurlWithdraw', () => {
  beforeEach(() => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });
  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it('returns withdraw params on a valid response', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag: 'withdrawRequest',
        callback: 'https://example.com/cb',
        k1: 'deadbeef',
        defaultDescription: '🐷 Birthday Piggy',
        minWithdrawable: 21_000,
        maxWithdrawable: 21_000,
      }),
    });

    const params = await resolveLnurlWithdraw('lnurlw://example.com/w');
    expect(params).toEqual({
      callback: 'https://example.com/cb',
      k1: 'deadbeef',
      defaultDescription: '🐷 Birthday Piggy',
      minWithdrawable: 21_000,
      maxWithdrawable: 21_000,
    });
  });

  it('throws when the JSON is not a withdrawRequest', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tag: 'payRequest', callback: 'https://x' }),
    });
    await expect(resolveLnurlWithdraw('lnurlw://example.com/w')).rejects.toThrow(
      /not a withdrawRequest/i,
    );
  });

  it('throws when the endpoint returns non-OK', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(resolveLnurlWithdraw('lnurlw://example.com/w')).rejects.toThrow(/404/);
  });
});

describe('msatToSats', () => {
  it('floors to whole sats', () => {
    expect(msatToSats(0)).toBe(0);
    expect(msatToSats(999)).toBe(0);
    expect(msatToSats(1_000)).toBe(1);
    expect(msatToSats(21_500)).toBe(21);
    expect(msatToSats(1_000_000)).toBe(1_000);
  });
});
