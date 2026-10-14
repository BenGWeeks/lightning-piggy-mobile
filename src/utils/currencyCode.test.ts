import { SATS_CURRENCY_CODE, normalizeCurrencyCode, sameCurrencyCode } from './currencyCode';

describe('normalizeCurrencyCode', () => {
  it.each(['SAT', 'SATS', 'sat', 'sats', 'Sats', 'Sat', ' sats '])(
    'folds the sats spelling %p into SATS',
    (input) => {
      expect(normalizeCurrencyCode(input)).toBe(SATS_CURRENCY_CODE);
    },
  );

  it('upper-cases and trims other codes', () => {
    expect(normalizeCurrencyCode('eur')).toBe('EUR');
    expect(normalizeCurrencyCode(' gbp ')).toBe('GBP');
    expect(normalizeCurrencyCode('USD')).toBe('USD');
    expect(normalizeCurrencyCode('btc')).toBe('BTC');
  });

  it('keeps millisatoshi units distinct from sats (amounts are not converted)', () => {
    expect(normalizeCurrencyCode('msat')).toBe('MSAT');
    expect(normalizeCurrencyCode('MSATS')).toBe('MSATS');
  });
});

describe('sameCurrencyCode', () => {
  it('matches across spellings', () => {
    expect(sameCurrencyCode('sat', 'SATS')).toBe(true);
    expect(sameCurrencyCode('eur', 'EUR')).toBe(true);
  });

  it('distinguishes different currencies', () => {
    expect(sameCurrencyCode('SATS', 'BTC')).toBe(false);
    expect(sameCurrencyCode('MSAT', 'SAT')).toBe(false);
  });
});
