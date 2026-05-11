import {
  __resetCacheForTest,
  acceptsLightning,
  acceptsOnchain,
  daysSinceVerified,
  fetchPlacesInBbox,
  formatAddress,
  lightningAddressOf,
  type BtcMapPlace,
} from './btcMapService';

const makePlace = (overrides: Partial<BtcMapPlace> = {}): BtcMapPlace => ({
  id: 1,
  lat: 51.5,
  lon: -0.1,
  tags: { name: 'Test Café' },
  verified_at: null,
  ...overrides,
});

describe('btcMapService helpers', () => {
  describe('acceptsLightning / acceptsOnchain', () => {
    it('detects payment:lightning yes', () => {
      const p = makePlace({ tags: { name: 'X', 'payment:lightning': 'yes' } });
      expect(acceptsLightning(p)).toBe(true);
    });

    it('detects payment:lightning_contactless yes', () => {
      const p = makePlace({ tags: { name: 'X', 'payment:lightning_contactless': 'yes' } });
      expect(acceptsLightning(p)).toBe(true);
    });

    it('does not falsely report lightning when only onchain is set', () => {
      const p = makePlace({ tags: { name: 'X', 'payment:onchain': 'yes' } });
      expect(acceptsLightning(p)).toBe(false);
      expect(acceptsOnchain(p)).toBe(true);
    });

    it('treats payment:bitcoin yes as onchain (legacy OSM tag)', () => {
      const p = makePlace({ tags: { name: 'X', 'payment:bitcoin': 'yes' } });
      expect(acceptsOnchain(p)).toBe(true);
    });
  });

  describe('lightningAddressOf', () => {
    it('prefers payment:lightning_address tag', () => {
      const p = makePlace({
        tags: { name: 'X', 'payment:lightning_address': 'cafe@example.com', lud16: 'fallback@x' },
      });
      expect(lightningAddressOf(p)).toBe('cafe@example.com');
    });

    it('falls back to lud16', () => {
      const p = makePlace({ tags: { name: 'X', lud16: 'cafe@x' } });
      expect(lightningAddressOf(p)).toBe('cafe@x');
    });

    it('returns null when neither is present', () => {
      expect(lightningAddressOf(makePlace())).toBeNull();
    });
  });

  describe('formatAddress', () => {
    it('joins available street / city / postcode parts', () => {
      const p = makePlace({
        tags: { name: 'X', 'addr:street': '1 Main St', 'addr:city': 'London' },
      });
      expect(formatAddress(p)).toBe('1 Main St, London');
    });

    it('falls back to lat/lon when no address tags exist', () => {
      const p = makePlace({ lat: 51.5074, lon: -0.1278 });
      expect(formatAddress(p)).toBe('51.5074, -0.1278');
    });
  });

  describe('daysSinceVerified', () => {
    it('returns null for unverified places', () => {
      expect(daysSinceVerified(makePlace({ verified_at: null }))).toBeNull();
    });

    it('returns null for unparseable timestamps rather than NaN', () => {
      expect(daysSinceVerified(makePlace({ verified_at: 'not-a-date' }))).toBeNull();
    });

    it('returns rounded-down days for a valid ISO timestamp', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000).toISOString();
      expect(daysSinceVerified(makePlace({ verified_at: tenDaysAgo }))).toBe(10);
    });
  });
});

describe('fetchPlacesInBbox cache', () => {
  beforeEach(() => {
    __resetCacheForTest();
    // jest.fn replaces global fetch per-test so we control responses without
    // hitting the network — same pattern other unit tests in this repo use.
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it('caches the global dataset across calls within TTL and filters by bbox', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    // BTC Map v4 returns a flat array; each tag comes back as a
    // prefixed top-level field (`osm:name`, `osm:payment:lightning`,
    // …). reshape() pulls the `osm:` prefix off and rebuilds the
    // BtcMapPlace.tags map.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 42, lat: 51.5, lon: -0.1, 'osm:name': 'Cached café' },
        // Outside bbox — used to confirm client-side filter.
        { id: 99, lat: 60.0, lon: 30.0, 'osm:name': 'Faraway place' },
      ],
    });

    const expected: BtcMapPlace = {
      id: 42,
      lat: 51.5,
      lon: -0.1,
      tags: { name: 'Cached café' },
      verified_at: null,
    };
    const bbox = { minLon: -0.2, minLat: 51.4, maxLon: 0.0, maxLat: 51.6 };
    const first = await fetchPlacesInBbox(bbox);
    const second = await fetchPlacesInBbox(bbox);

    expect(first).toEqual([expected]);
    expect(second).toEqual([expected]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it('throws a useful error when v4 returns non-OK', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const bbox = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
    await expect(fetchPlacesInBbox(bbox)).rejects.toThrow(/BTC Map v4 503/);
  });
});
