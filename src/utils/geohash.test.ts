import {
  bearingDegrees,
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashNeighbours,
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

describe('bearingDegrees', () => {
  it('is 0 for identical points (avoids platform-dependent atan2(0,0))', () => {
    expect(bearingDegrees({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBe(0);
  });

  it('returns ~0 for due-north travel', () => {
    // London → Cambridge is roughly north-north-east; pure north is at
    // a point directly above London.
    const b = bearingDegrees({ lat: 51.5, lon: -0.1 }, { lat: 52.5, lon: -0.1 });
    expect(b).toBeCloseTo(0, 0);
  });

  it('returns ~90 for due-east travel', () => {
    const b = bearingDegrees({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: 0.9 });
    expect(b).toBeGreaterThan(89);
    expect(b).toBeLessThan(91);
  });

  it('returns ~180 for due-south travel', () => {
    const b = bearingDegrees({ lat: 51.5, lon: -0.1 }, { lat: 50.5, lon: -0.1 });
    expect(b).toBeCloseTo(180, 0);
  });

  it('returns ~270 for due-west travel', () => {
    const b = bearingDegrees({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -1.1 });
    expect(b).toBeGreaterThan(269);
    expect(b).toBeLessThan(271);
  });

  it('always returns a value in [0, 360)', () => {
    // Spot-check: south-west neighbour should be in (180, 270).
    const b = bearingDegrees({ lat: 51.5, lon: -0.1 }, { lat: 51.0, lon: -0.6 });
    expect(b).toBeGreaterThan(180);
    expect(b).toBeLessThan(270);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
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

  it('returns "< 5 m" for tiny distances that would round to 0 m', () => {
    expect(formatDistance(0)).toBe('< 5 m');
    expect(formatDistance(1.2)).toBe('< 5 m');
    expect(formatDistance(4)).toBe('< 5 m');
    // 5 m and above round normally
    expect(formatDistance(5)).toBe('10 m');
  });
});

describe('geohashNeighbours', () => {
  // Issue #631 — the missing-neighbours bug that caused the empty
  // Geo-caches rail. These tests pin the surface area at exactly
  // 9 tiles (self + 8) and verify the user's own tile is one of them.

  it('returns the cell itself plus its 8 neighbours at the same precision', () => {
    const n = geohashNeighbours('u1219');
    expect(n).toHaveLength(9);
    // Every neighbour matches the requested precision.
    for (const g of n) expect(g).toHaveLength(5);
    // Self is one of them.
    expect(n).toContain('u1219');
  });

  it('includes the neighbour tiles a real Pixel near Longstanton would need', () => {
    // The bug surfaced specifically because Longstanton (~u121926)
    // produces own-tile u1219 but published test caches sit in u1218
    // (~1 km east) and u1213. Both must appear in the result so the
    // `#g` filter matches them.
    const n = geohashNeighbours('u1219');
    expect(n).toContain('u1218');
    expect(n).toContain('u1213');
  });

  it('returns an empty array for an empty input', () => {
    expect(geohashNeighbours('')).toEqual([]);
  });

  it('respects the input precision — no shorter or longer hashes leak', () => {
    const n = geohashNeighbours('u12');
    for (const g of n) expect(g).toHaveLength(3);
  });

  it('handles antimeridian wrap-around — neighbours of a meridian-edge tile resolve', () => {
    // A tile abutting longitude 180° / -180° still has east + west
    // neighbours; they wrap across the dateline rather than vanishing.
    // 'zzzzz' sits at the +180° edge; its west neighbour should not
    // be missing from the result.
    const n = geohashNeighbours('zzzzz');
    expect(n.length).toBeGreaterThanOrEqual(6);
    // No invalid (pre-encode) characters in any returned hash.
    for (const g of n) expect(g).toMatch(/^[0-9b-hjkmnp-z]+$/);
  });

  it('handles poles — past-pole positions are skipped, valid neighbours preserved', () => {
    // 'bpbpbpb' is right at the north pole; some of the 3×3 grid
    // positions step off the planet (lat > 90°). Those are skipped,
    // not returned as invalid hashes.
    const n = geohashNeighbours('b');
    // Self at minimum.
    expect(n.length).toBeGreaterThanOrEqual(1);
    expect(n).toContain('b');
  });
});

describe('geohashPrefixesForBbox', () => {
  const { geohashPrefixesForBbox, encodeGeohash: enc } = jest.requireActual('./geohash');

  it('covers a city-scale bbox at precision 5 within budget', () => {
    // ~10 km around Longstanton, Cambridge.
    const tiles = geohashPrefixesForBbox({
      minLat: 52.26,
      maxLat: 52.31,
      minLon: 0.02,
      maxLon: 0.07,
    });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(9);
    expect(tiles.every((t: string) => t.length === 5)).toBe(true);
    // The user's own tile must be in the covering set.
    expect(tiles).toContain(enc(52.2836, 0.0439, 5));
  });

  it('coarsens to a lower precision for a country-scale bbox', () => {
    // Roughly Denmark.
    const tiles = geohashPrefixesForBbox({ minLat: 54.5, maxLat: 57.8, minLon: 8, maxLon: 12.7 });
    expect(tiles.length).toBeLessThanOrEqual(9);
    const precision = tiles[0].length;
    expect(precision).toBeGreaterThanOrEqual(3);
    expect(precision).toBeLessThan(5);
    // Johnnymoonshine's Livø Havn Piglet (56.887, 9.099) must be covered.
    expect(tiles).toContain(enc(56.887, 9.099, precision));
  });

  it('falls back to centre + neighbours at min precision for a world bbox', () => {
    const tiles = geohashPrefixesForBbox({ minLat: -60, maxLat: 75, minLon: -170, maxLon: 170 });
    expect(tiles.length).toBeLessThanOrEqual(9);
    expect(tiles.every((t: string) => t.length === 3)).toBe(true);
  });

  it('never returns tiles below precision 3 (publishers only tag 3..9)', () => {
    const tiles = geohashPrefixesForBbox({ minLat: 30, maxLat: 70, minLon: -20, maxLon: 40 });
    expect(tiles.every((t: string) => t.length >= 3)).toBe(true);
  });
});

describe('geohashPrefixesForBbox edge cases (Copilot review on #1069)', () => {
  const { geohashPrefixesForBbox, encodeGeohash: enc } = jest.requireActual('./geohash');

  it('returns the containing tile for a degenerate bbox exactly on a grid boundary', () => {
    const tiles = geohashPrefixesForBbox({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles).toContain(enc(0, 0, 5));
  });

  it('falls back around a wrapped mid-longitude for an antimeridian-crossing bbox', () => {
    // minLon > maxLon: crosses the antimeridian. Naive averaging would
    // centre on lon 0; the wrapped midpoint is ±180.
    const tiles = geohashPrefixesForBbox({ minLat: -10, maxLat: 10, minLon: 170, maxLon: -170 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0]).toBe(enc(0, -180, 3));
    expect(tiles).not.toContain(enc(0, 0, 3));
  });

  it('keeps the centre tile first in the fallback so a small maxTiles cannot drop it', () => {
    const tiles = geohashPrefixesForBbox({ minLat: -60, maxLat: 75, minLon: -170, maxLon: 170 }, 1);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toBe(enc(7.5, 0, 3));
  });
});
