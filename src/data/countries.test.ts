import { COUNTRIES, countryName, isKnownCountry, toAlpha2 } from './countries';

describe('COUNTRIES', () => {
  it('codes are unique, uppercase ISO 3166-1 alpha-2', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it('alpha3 codes are unique, uppercase ISO 3166-1 alpha-3', () => {
    const codes = COUNTRIES.map((c) => c.alpha3);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it('toAlpha2 maps alpha-3 down, passes alpha-2 through, uppercases unknowns', () => {
    expect(toAlpha2('GBR')).toBe('GB');
    expect(toAlpha2('deu')).toBe('DE');
    expect(toAlpha2('GB')).toBe('GB');
    expect(toAlpha2('xx')).toBe('XX');
  });

  it('is sorted by display name so the picker scans alphabetically', () => {
    const names = COUNTRIES.map((c) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    expect(names).toEqual(sorted);
  });

  it('resolves names case-insensitively and falls back to the code', () => {
    expect(countryName('gb')).toBe('United Kingdom');
    expect(countryName('US')).toBe('United States');
    expect(countryName('zz')).toBe('ZZ');
    expect(isKnownCountry('de')).toBe(true);
    expect(isKnownCountry('ZZ')).toBe(false);
  });
});
