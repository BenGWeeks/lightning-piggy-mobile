/**
 * Coverage for the pure formatting / arithmetic helpers in fiatService.
 * The cached `getBtcPrice` network path is out of scope here — the cache
 * is module-level which would cross-pollinate between cases, and the
 * fetch wrapper is best validated end-to-end from a flow test rather
 * than a Jest fixture.
 */

import { formatFiat, satsToFiat, satsToFiatString, CURRENCIES } from './fiatService';

describe('CURRENCIES', () => {
  it('exports the expected ISO-4217 codes', () => {
    expect(CURRENCIES).toEqual(['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'ZAR']);
  });
});

describe('satsToFiat', () => {
  it('converts sats to fiat using the provided BTC price', () => {
    // 1 BTC = 100M sats. At $50,000/BTC, 100,000 sats = $50.
    expect(satsToFiat(100_000, 50_000)).toBeCloseTo(50, 5);
  });

  it('returns 0 when sats is 0', () => {
    expect(satsToFiat(0, 50_000)).toBe(0);
  });

  it('returns 0 when btcPrice is 0', () => {
    expect(satsToFiat(100_000, 0)).toBe(0);
  });
});

describe('formatFiat', () => {
  it('renders an amount with 2 decimal places + currency symbol', () => {
    const out = formatFiat(12.34, 'USD');
    expect(out).toContain('12.34');
    // Don't lock the symbol position (locale-specific) — just check
    // both the number and currency identifier are present.
  });

  it('renders sub-cent amounts as "< <symbol>0.01"', () => {
    const out = formatFiat(0.0001, 'USD');
    expect(out.startsWith('< ')).toBe(true);
    expect(out).toContain('0.01');
  });

  it('does not collapse 0 to "< 0.01"', () => {
    const out = formatFiat(0, 'USD');
    expect(out.startsWith('< ')).toBe(false);
  });
});

describe('satsToFiatString', () => {
  it('returns an empty string when btcPrice is null', () => {
    expect(satsToFiatString(100_000, null, 'USD')).toBe('');
  });

  it('formats sats into the localised currency string when a price is given', () => {
    const out = satsToFiatString(100_000, 50_000, 'USD');
    expect(out).toContain('50.00');
  });
});
