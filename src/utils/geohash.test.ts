import { encodeGeohash, geohashPrefixes } from './geohash';

describe('encodeGeohash', () => {
  // Spot-check a few well-known coordinates against published geohash values
  // to confirm the encoder agrees with the rest of the world (en.wikipedia.org
  // /wiki/Geohash + geohash.org).
  it.each([
    // Cambridge value verified end-to-end via the publish-test-piggy script
    // — the kind-30408 event we sent to relay.damus.io carries the same g7.
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
