import {
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashPrefixes,
  haversineMetres,
} from './geohash';

describe('encodeGeohash', () => {
  // Spot-check a few well-known coordinates against published geohash values
  // to confirm the encoder agrees with the rest of the world (en.wikipedia.org
  // /wiki/Geohash + geohash.org).
  it.each([
    // Cambridge value verified end-to-end via the publish-test-piggy script
    // — the kind 37516 NIP-GC event we sent to relay.damus.io carries the same g7.
    ['Longstanton, Cambridge', 52.283602, 0.043889, 'u1212vz'],
    ['Eiffel Tower', 48.8584, 2.2945, 'u09tunq'],
    // Statue of Liberty — cross-check against geohash.org / Niemeyer ref impl.
    ['Statue of Liberty', 40.6892, -74.0445, 'dr5r7p4'],
  ])('%s → %s', (_label, lat, lon, expected) => {
    expect(encodeGeohash(lat, lon, 7)).toBe(expected);
  });

  it('respects the precision argument', () => {
    expect(encodeGeohash(52.283602, 0.043889, 5)).toBe('u1212');
    expect(encodeGeohash(52.283602, 0.043889, 4)).toBe('u121');
  });

  it('throws on non-finite inputs', () => {
    expect(() => encodeGeohash(NaN, 0)).toThrow();
    expect(() => encodeGeohash(0, Infinity)).toThrow();
  });
});

describe('geohashPrefixes', () => {
  it('returns successively coarser prefixes down to minLen', () => {
    expect(geohashPrefixes('u1212vz', 4)).toEqual(['u1212vz', 'u1212v', 'u1212', 'u121']);
  });

  it('respects custom minLen', () => {
    expect(geohashPrefixes('u1212vz', 6)).toEqual(['u1212vz', 'u1212v']);
  });

  it('returns just the input when length equals minLen', () => {
    expect(geohashPrefixes('u121', 4)).toEqual(['u121']);
  });
});

describe('decodeGeohash', () => {
  it('round-trips a precision-7 encode within half a cell', () => {
    const lat = 52.205;
    const lon = 0.121;
    const { lat: decLat, lng: decLng } = decodeGeohash(encodeGeohash(lat, lon, 7));
    expect(Math.abs(decLat - lat)).toBeLessThan(0.001);
    expect(Math.abs(decLng - lon)).toBeLessThan(0.001);
  });
});

describe('haversineMetres', () => {
  it('is zero for identical points', () => {
    expect(haversineMetres({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBe(0);
  });

  it('matches a known reference (London → Cambridge ≈ 80 km)', () => {
    const d = haversineMetres({ lat: 51.5074, lon: -0.1278 }, { lat: 52.2053, lon: 0.1218 });
    expect(d).toBeGreaterThan(79_000);
    expect(d).toBeLessThan(81_000);
  });

  it('is symmetric', () => {
    const a = { lat: 51.5, lon: -0.1 };
    const b = { lat: 52.0, lon: 0.5 };
    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 6);
  });
});

describe('formatDistance', () => {
  it('rounds sub-1 km values to the nearest 10 m', () => {
    expect(formatDistance(217)).toBe('220 m');
    expect(formatDistance(12)).toBe('10 m');
  });

  it('uses 1 decimal place between 1 km and 10 km', () => {
    expect(formatDistance(3210)).toBe('3.2 km');
  });

  it('uses whole km above 10 km', () => {
    expect(formatDistance(42_500)).toBe('43 km');
  });

  it('returns empty string for non-finite or negative input', () => {
    expect(formatDistance(NaN)).toBe('');
    expect(formatDistance(-1)).toBe('');
  });
});
