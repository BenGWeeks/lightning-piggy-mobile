import { isSameFix } from './locationFix';

describe('isSameFix — GPS fix value-dedupe (sporadic-freeze trigger)', () => {
  const base = { lat: 52.2964, lon: 0.0589, accuracy: 4.5 };

  it('treats a byte-identical redelivered fix as the same place', () => {
    expect(isSameFix(base, { ...base })).toBe(true);
  });

  it('treats sub-metre GPS jitter as the same place (5 dp ≈ 1.1 m)', () => {
    // ±0.000004° ≈ 0.4 m — typical stationary jitter; rounds to the same 5 dp.
    expect(isSameFix(base, { ...base, lat: 52.296404, lon: 0.058904 })).toBe(true);
  });

  it('treats a genuine move as a different place', () => {
    // +0.0002° ≈ 22 m — a real step past the watch's distance gate.
    expect(isSameFix(base, { ...base, lat: 52.2966 })).toBe(false);
    expect(isSameFix(base, { ...base, lon: 0.0591 })).toBe(false);
  });

  it('ignores accuracy flutter inside the same 5 m bucket', () => {
    expect(isSameFix(base, { ...base, accuracy: 5.9 })).toBe(true);
  });

  it('detects a materially different accuracy halo', () => {
    expect(isSameFix(base, { ...base, accuracy: 25 })).toBe(false);
  });

  it('handles null accuracy on either side', () => {
    expect(isSameFix({ ...base, accuracy: null }, { ...base, accuracy: null })).toBe(true);
    expect(isSameFix({ ...base, accuracy: null }, base)).toBe(false);
    expect(isSameFix(base, { ...base, accuracy: null })).toBe(false);
  });

  it('is exact at the 5 dp boundary in both hemispheres', () => {
    const west = { lat: -33.86882, lon: -151.20929, accuracy: null };
    expect(isSameFix(west, { ...west })).toBe(true);
    expect(isSameFix(west, { ...west, lat: -33.86893 })).toBe(false);
  });
});
