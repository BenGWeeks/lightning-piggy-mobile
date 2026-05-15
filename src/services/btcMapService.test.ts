import {
  __resetCacheForTest,
  acceptsLightning,
  acceptsOnchain,
  daysSinceVerified,
  fetchPlacesInBbox,
  formatAddress,
  lightningAddressOf,
  peekCachedAnchorSync,
  peekCachedPlacesSync,
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

describe('fetchPlacesInBbox (search endpoint)', () => {
  beforeEach(() => {
    __resetCacheForTest();
    // jest.fn replaces global fetch per-test so we control responses without
    // hitting the network — same pattern other unit tests in this repo use.
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  const reshapeExpected = (overrides: Partial<BtcMapPlace>): BtcMapPlace => ({
    id: 0,
    lat: 0,
    lon: 0,
    tags: {},
    verified_at: null,
    description: null,
    icon: null,
    osm_url: null,
    categories: null,
    phone: null,
    email: null,
    opening_hours: null,
    facebookUrl: null,
    twitterUrl: null,
    instagramUrl: null,
    telegramUrl: null,
    whatsappUrl: null,
    createdAt: null,
    updatedAt: null,
    boostedUntil: null,
    commentsCount: null,
    ...overrides,
  });

  it('hits /v4/places/search with a centre + radius derived from the bbox', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    // The search endpoint returns a flat array; each tag comes back as a
    // prefixed top-level field (`osm:name`, …) which reshape() un-prefixes.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 42, lat: 51.5, lon: -0.1, 'osm:name': 'Café' }],
    });

    const bbox = { minLon: -0.2, minLat: 51.4, maxLon: 0.0, maxLat: 51.6 };
    const result = await fetchPlacesInBbox(bbox);

    expect(result).toEqual([
      reshapeExpected({ id: 42, lat: 51.5, lon: -0.1, tags: { name: 'Café' } }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v4/places/search');
    // Centre of the bbox = midpoint; radius reaches the far corner.
    expect(url).toContain('lat=51.5');
    expect(url).toContain('lon=-0.1');
    expect(url).toMatch(/radius_km=\d+/);
  });

  it('re-fetches per viewport — no cross-call caching', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    const bbox = { minLon: -0.2, minLat: 51.4, maxLon: 0.0, maxLat: 51.6 };
    await fetchPlacesInBbox(bbox);
    await fetchPlacesInBbox(bbox);

    // The search endpoint is cheap + viewport-scoped, so each call hits
    // the network (callers debounce map-pan / zoom themselves).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the last result when the search endpoint errors', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    const bbox = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };

    // First call succeeds and populates the in-memory cache.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 7, lat: 0.5, lon: 0.5, 'osm:name': 'Cached' }],
    });
    const first = await fetchPlacesInBbox(bbox);
    expect(first).toEqual([
      reshapeExpected({ id: 7, lat: 0.5, lon: 0.5, tags: { name: 'Cached' } }),
    ]);

    // Second call errors — should resolve with the cached result, not throw.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const second = await fetchPlacesInBbox(bbox);
    expect(second).toEqual(first);
  });

  it('resolves to an empty list when the first-ever fetch fails with no cache', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    const bbox = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
    await expect(fetchPlacesInBbox(bbox)).resolves.toEqual([]);
  });

  it('populates peekCachedPlacesSync + peekCachedAnchorSync after a successful fetch', async () => {
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 99, lat: 52.0, lon: 0.0, 'osm:name': 'Anchor Café' }],
    });

    // Pre-fetch, the sync peeks return empty / null — module-import
    // hydrate has nothing on disk in the test sandbox.
    expect(peekCachedPlacesSync()).toEqual([]);
    expect(peekCachedAnchorSync()).toBeNull();

    const bbox = { minLon: -0.1, minLat: 51.9, maxLon: 0.1, maxLat: 52.1 };
    await fetchPlacesInBbox(bbox);

    // Post-fetch, the in-memory mirror is hot — Explore hub useState
    // initialisers will see the data without an await on next mount.
    expect(peekCachedPlacesSync()).toHaveLength(1);
    expect(peekCachedPlacesSync()[0].id).toBe(99);
    expect(peekCachedAnchorSync()).toEqual({ lat: 52.0, lon: 0.0 });
  });
});
