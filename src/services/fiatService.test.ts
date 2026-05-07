import { CURRENCIES, CURRENCY_LIST, formatFiat, satsToFiat } from './fiatService';

// CoinGecko's `simple/supported_vs_currencies` response captured 2026-05-07.
// Reproduce locally with:
//   curl -s 'https://api.coingecko.com/api/v3/simple/supported_vs_currencies'
// If CoinGecko removes a code we ship, this test catches it before users do.
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
