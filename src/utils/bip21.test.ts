import { parseBip21, buildBip21 } from './bip21';

describe('parseBip21', () => {
  it('parses bare bitcoin: URI without amount', () => {
    const r = parseBip21('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(r).toEqual({
      raw: 'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      amountSats: null,
    });
  });

  it('parses BIP-21 amount via BigInt for sat precision', () => {
    const r = parseBip21('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.00012345');
    expect(r?.amountSats).toBe(12345);
  });

  it('handles 0.0001 → 10000 sats exactly', () => {
    expect(parseBip21('bitcoin:bc1qabc12345?amount=0.0001')?.amountSats).toBe(10000);
  });

  it('returns null for non-bitcoin URI', () => {
    expect(parseBip21('lightning:lnbc100')).toBeNull();
    expect(parseBip21('hello world')).toBeNull();
    expect(parseBip21('')).toBeNull();
  });

  it('rejects amounts over 21M BTC', () => {
    expect(parseBip21('bitcoin:bc1qabc12345?amount=22000000')?.amountSats).toBeNull();
  });

  it('rejects malformed amount', () => {
    expect(parseBip21('bitcoin:bc1qabc12345?amount=abc')?.amountSats).toBeNull();
    expect(parseBip21('bitcoin:bc1qabc12345?amount=0.123456789')?.amountSats).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const r = parseBip21('  bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh  ');
    expect(r?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
  });

  it('matches mixed case scheme', () => {
    expect(parseBip21('BITCOIN:bc1qabc12345')?.address).toBe('bc1qabc12345');
  });

  it('rejects amount=0 (zero is not a meaningful share)', () => {
    expect(parseBip21('bitcoin:bc1qabc12345?amount=0')?.amountSats).toBeNull();
  });
});

describe('buildBip21', () => {
  it('builds bare URI without amount', () => {
    expect(buildBip21('bc1qabc')).toBe('bitcoin:bc1qabc');
    expect(buildBip21('bc1qabc', null)).toBe('bitcoin:bc1qabc');
    expect(buildBip21('bc1qabc', 0)).toBe('bitcoin:bc1qabc');
  });

  it('builds URI with BIP-21 amount in BTC, 8 fractional digits', () => {
    expect(buildBip21('bc1qabc', 10000)).toBe('bitcoin:bc1qabc?amount=0.00010000');
    expect(buildBip21('bc1qabc', 100000000)).toBe('bitcoin:bc1qabc?amount=1.00000000');
    expect(buildBip21('bc1qabc', 12345)).toBe('bitcoin:bc1qabc?amount=0.00012345');
  });

  it('returns empty string when address is missing', () => {
    expect(buildBip21('')).toBe('');
    expect(buildBip21('', 1000)).toBe('');
  });

  it('round-trips through parseBip21', () => {
    const built = buildBip21('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 12345);
    const parsed = parseBip21(built);
    expect(parsed?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(parsed?.amountSats).toBe(12345);
  });
});
