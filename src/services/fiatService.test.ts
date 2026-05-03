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
    // formatFiat goes through `toLocaleString(undefined, ...)`, so the
    // decimal separator (.,) and grouping/spacing are locale-driven.
    // Compute the locale-correct fraction substring at runtime so the
    // assertion is valid on `de-DE` ("12,34 $") just as much as on
    // `en-US` ("$12.34").
    const expectedNumber = (12.34).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(out).toContain(expectedNumber);
  });

  it('renders sub-cent amounts as "< <symbol>0.01"', () => {
    const out = formatFiat(0.0001, 'USD');
    expect(out.startsWith('< ')).toBe(true);
    // Compute the locale-correct "0.01" substring (`0,01` on `de-DE`
    // etc.) so the assertion is locale-agnostic.
    const expectedFloor = (0.01).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(out).toContain(expectedFloor);
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
    // Like formatFiat above, the result goes through
    // toLocaleString(undefined, ...) — compute the expected `50.00`
    // substring in the host locale so this passes on `de-DE` /
    // `fr-FR` / etc., where the decimal separator differs.
    const expected = (50).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(out).toContain(expected);
  });
});
