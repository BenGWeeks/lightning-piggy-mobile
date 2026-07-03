import { bech32 } from 'bech32';
import {
  claimLnurlWithdraw,
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

describe('claimLnurlWithdraw', () => {
  const params = {
    callback: 'https://example.com/cb',
    k1: 'deadbeef',
    defaultDescription: 'Geo-Cache 1',
    minWithdrawable: 21_000,
    maxWithdrawable: 21_000,
  };

  beforeEach(() => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });
  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it('happy path — POSTs k1+pr to callback, returns sats + bolt11', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'OK' }) });
    const getInvoice = jest.fn(async () => 'lnbcfakeinvoice');

    const result = await claimLnurlWithdraw(params, getInvoice);
    expect(result).toEqual({ sats: 21, bolt11: 'lnbcfakeinvoice' });
    expect(getInvoice).toHaveBeenCalledWith(21, 'Geo-Cache 1');
    // URL should carry both query params.
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('k1=deadbeef');
    expect(calledUrl).toContain('pr=lnbcfakeinvoice');
  });

  it('refuses to claim when maxWithdrawable is zero (cooldown / budget)', async () => {
    const getInvoice = jest.fn();
    await expect(claimLnurlWithdraw({ ...params, maxWithdrawable: 0 }, getInvoice)).rejects.toThrow(
      /sleeping/i,
    );
    expect(getInvoice).not.toHaveBeenCalled();
  });

  it('surfaces issuer ERROR.reason verbatim', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ERROR', reason: 'wait_time not yet expired' }),
    });
    const getInvoice = jest.fn(async () => 'lnbcfake');
    await expect(claimLnurlWithdraw(params, getInvoice)).rejects.toThrow(
      'wait_time not yet expired',
    );
  });

  it('throws on non-OK HTTP', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const getInvoice = jest.fn(async () => 'lnbcfake');
    await expect(claimLnurlWithdraw(params, getInvoice)).rejects.toThrow(/503/);
  });

  it('throws if the response is not JSON', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    });
    const getInvoice = jest.fn(async () => 'lnbcfake');
    await expect(claimLnurlWithdraw(params, getInvoice)).rejects.toThrow(/did not return JSON/i);
  });
});
