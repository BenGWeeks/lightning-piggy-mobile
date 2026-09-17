import {
  CURRENCIES,
  CURRENCY_LIST,
  __resetBtcPriceCacheForTests,
  currencySymbol,
  formatFiat,
  getBtcPrice,
  satsToFiat,
  satsToFiatString,
} from './fiatService';

// Hard-coded snapshot of CoinGecko's `simple/supported_vs_currencies`
// captured 2026-05-07. This pins the codes we ship against a known
// support set at the time of capture — it does NOT detect upstream
// changes automatically. Re-snapshot manually when adding new codes:
//   curl -s 'https://api.coingecko.com/api/v3/simple/supported_vs_currencies'
const COINGECKO_SUPPORTED = new Set([
  'btc',
  'eth',
  'ltc',
  'bch',
  'bnb',
  'eos',
  'xrp',
  'xlm',
  'link',
  'dot',
  'yfi',
  'sol',
  'usd',
  'aed',
  'ars',
  'aud',
  'bdt',
  'bhd',
  'bmd',
  'brl',
  'cad',
  'chf',
  'clp',
  'cny',
  'czk',
  'dkk',
  'eur',
  'gbp',
  'gel',
  'hkd',
  'huf',
  'idr',
  'ils',
  'inr',
  'jpy',
  'krw',
  'kwd',
  'lkr',
  'mmk',
  'mxn',
  'myr',
  'ngn',
  'nok',
  'nzd',
  'php',
  'pkr',
  'pln',
  'rub',
  'sar',
  'sek',
  'sgd',
  'thb',
  'try',
  'twd',
  'uah',
  'vef',
  'vnd',
  'zar',
  'xdr',
  'xag',
  'xau',
  'bits',
  'sats',
]);

describe('CURRENCY_LIST', () => {
  it('every entry is supported by CoinGecko simple/price', () => {
    for (const c of CURRENCY_LIST) {
      expect(COINGECKO_SUPPORTED.has(c.code.toLowerCase())).toBe(true);
    }
  });

  it('has unique currency codes', () => {
    const codes = CURRENCY_LIST.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every entry has non-empty name and symbol', () => {
    for (const c of CURRENCY_LIST) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.symbol.length).toBeGreaterThan(0);
    }
  });

  it('keeps USD/EUR/GBP at the top for global majors', () => {
    expect(CURRENCY_LIST[0]?.code).toBe('USD');
    expect(CURRENCY_LIST[1]?.code).toBe('EUR');
    expect(CURRENCY_LIST[2]?.code).toBe('GBP');
  });

  it('includes DKK (the issue-#425 motivating example)', () => {
    expect(CURRENCY_LIST.find((c) => c.code === 'DKK')).toBeDefined();
  });

  it('CURRENCIES legacy export mirrors CURRENCY_LIST codes', () => {
    expect(CURRENCIES).toEqual(CURRENCY_LIST.map((c) => c.code));
  });
});

describe('satsToFiat', () => {
  it('converts 100M sats at $50k/BTC to $50,000', () => {
    expect(satsToFiat(100_000_000, 50_000)).toBe(50_000);
  });

  it('converts 1k sats at $50k/BTC to $0.50', () => {
    expect(satsToFiat(1_000, 50_000)).toBeCloseTo(0.5);
  });
});

describe('formatFiat', () => {
  it('formats USD with two decimals', () => {
    // Locale-tolerant: some Intl locales render the decimal separator
    // as a comma (e.g. de-DE → "12,34"). Accept either separator so the
    // test is stable across CI/dev environments.
    const out = formatFiat(12.34, 'USD');
    expect(out).toMatch(/12[.,]34/);
  });

  it('shows "< $0.01" sentinel for sub-cent positive amounts', () => {
    const out = formatFiat(0.001, 'USD');
    expect(out.startsWith('< ')).toBe(true);
  });
});

describe('currencySymbol', () => {
  // Cover *every* currency the settings picker offers, not a hand-picked
  // few (#644 review): the placeholder renders for all 38, so all 38 need
  // a known-good symbol. This also locks in the function's contract —
  // it must always read from `CURRENCY_LIST`, never fall back to Intl,
  // whose rendering diverges for AUD/BRL/CHF/SEK and others.
  it.each(CURRENCY_LIST.map((c) => [c.code, c.symbol] as const))('%s -> %s', (code, expected) => {
    expect(currencySymbol(code)).toBe(expected);
  });

  it('falls back to the ISO code for unknown currencies', () => {
    expect(currencySymbol('ZZZ')).toBe('ZZZ');
  });
});

describe('satsToFiatString', () => {
  // The placeholder branch lets WalletCard keep a stable-height row
  // when the BTC price hasn't arrived yet (#633). EN DASH (U+2013) is
  // the deliberate glyph — see the comment on the function itself.
  it('returns a currency-symbol + en-dash placeholder when btcPrice is null', () => {
    const out = satsToFiatString(123_456, null, 'GBP');
    expect(out).toBe('£–');
  });

  it('uses the picker symbol for currencies whose Intl rendering varies (AUD)', () => {
    const out = satsToFiatString(123_456, null, 'AUD');
    expect(out).toBe('A$–');
  });

  it('renders a stable placeholder for every settings currency when btcPrice is null', () => {
    for (const c of CURRENCY_LIST) {
      expect(satsToFiatString(123_456, null, c.code)).toBe(`${c.symbol}–`);
    }
  });

  it('formats the regular value when btcPrice is present', () => {
    const out = satsToFiatString(100_000_000, 50_000, 'USD');
    // locale-tolerant: strip grouping/decimal marks (some locales use space/NBSP); 50000.00 → "5000000"
    expect(out.replace(/\D/g, '')).toBe('5000000');
  });
});

describe('getBtcPrice stale-rate policy', () => {
  const ok = (rate: number) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ bitcoin: { gbp: rate } }),
    } as Response);
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    __resetBtcPriceCacheForTests();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('falls back to an expired cached rate on network failure by default (display path)', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy.mockImplementationOnce(() => ok(50_000));
    expect(await getBtcPrice('GBP')).toBe(50_000);
    jest.setSystemTime(1_000_000 + 6 * 60 * 1000); // past the 5-minute cache
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    expect(await getBtcPrice('GBP')).toBe(50_000);
  });

  it('returns null instead of an expired rate when allowStale is false (checkout path)', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy.mockImplementationOnce(() => ok(50_000));
    expect(await getBtcPrice('GBP', { allowStale: false })).toBe(50_000);
    jest.setSystemTime(1_000_000 + 6 * 60 * 1000);
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    expect(await getBtcPrice('GBP', { allowStale: false })).toBeNull();
    // A fresh (< 5 min) cache hit is still served without a fetch.
    fetchSpy.mockImplementationOnce(() => ok(51_000));
    expect(await getBtcPrice('GBP', { allowStale: false })).toBe(51_000);
    expect(await getBtcPrice('GBP', { allowStale: false })).toBe(51_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('canonicalises the currency key (case / whitespace) so equivalent spellings share a cache entry', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy.mockImplementationOnce(() => ok(50_000));
    expect(await getBtcPrice('GBP')).toBe(50_000);
    expect(await getBtcPrice(' gbp ')).toBe(50_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caches per currency so a second currency does not evict the first', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy.mockImplementationOnce(() => ok(50_000));
    expect(await getBtcPrice('GBP')).toBe(50_000);
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ bitcoin: { eur: 58_000 } }),
      } as Response),
    );
    expect(await getBtcPrice('EUR')).toBe(58_000);
    expect(await getBtcPrice('GBP')).toBe(50_000); // still cached, no refetch
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('treats a non-2xx response as a failure so the display path keeps its stale rate', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy.mockImplementationOnce(() => ok(50_000));
    expect(await getBtcPrice('GBP')).toBe(50_000);
    jest.setSystemTime(1_000_000 + 6 * 60 * 1000);
    fetchSpy.mockImplementationOnce(
      () =>
      Promise.resolve({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) } as Response), // prettier-ignore
    );
    expect(await getBtcPrice('GBP')).toBe(50_000); // stale fallback, not null
  });

  it('aborts a hung request after the timeout and reports no rate', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const pending = getBtcPrice('GBP', { allowStale: false });
    await jest.advanceTimersByTimeAsync(8_100);
    expect(await pending).toBeNull();
  });
});
