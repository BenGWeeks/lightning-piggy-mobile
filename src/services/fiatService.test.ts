import {
  CURRENCIES,
  CURRENCY_LIST,
  currencySymbol,
  formatFiat,
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
