import { parseBolt11Sats } from './findLogZapsService';

// Tests concentrate on the failure-path contract — null on garbage —
// because the success path delegates to light-bolt11-decoder, whose
// own test suite covers amount parsing. The thing this helper adds is
// safe-by-default null handling; that's what's worth pinning.
describe('parseBolt11Sats', () => {
  it('returns null for empty input', () => {
    expect(parseBolt11Sats('')).toBeNull();
  });

  it('returns null for clearly malformed input', () => {
    expect(parseBolt11Sats('not-a-bolt11')).toBeNull();
  });

  it('returns null for a bolt11 prefix without payload', () => {
    expect(parseBolt11Sats('lnbc1')).toBeNull();
  });
});
