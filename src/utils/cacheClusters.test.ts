import { clusterCachePoints, type CacheClusterPoint } from './cacheClusters';

const point = (id: string, lat: number, lng: number): CacheClusterPoint => ({
  id,
  lat,
  lng,
  name: id,
  isLpPiggy: true,
  payoutSats: null,
});

// Longstanton's Piglets sit within ~1 km of each other; a merchant-scale
// test spread of ~0.005° ≈ 500 m.
const villageCluster = [
  point('a', 52.283, 0.044),
  point('b', 52.284, 0.046),
  point('c', 52.286, 0.043),
  point('d', 52.281, 0.048),
];
const farAway = point('copenhagen', 55.676, 12.568);

describe('clusterCachePoints', () => {
  it('returns an empty array for no points', () => {
    expect(clusterCachePoints([], 10)).toEqual([]);
  });

  it('groups co-located caches into one count chip at a wide zoom', () => {
    const items = clusterCachePoints([...villageCluster, farAway], 6);
    const clusters = items.filter((i) => i.kind === 'cluster');
    const leaves = items.filter((i) => i.kind === 'point');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind === 'cluster' && clusters[0].count).toBe(4);
    // The far-away cache stays an individual pin.
    expect(leaves.map((l) => (l.kind === 'point' ? l.point.id : ''))).toEqual(['copenhagen']);
  });

  it('separates every cache once zoomed past the expansion zoom', () => {
    const wide = clusterCachePoints(villageCluster, 6);
    const cluster = wide.find((i) => i.kind === 'cluster');
    expect(cluster).toBeDefined();
    const expansion = cluster!.kind === 'cluster' ? cluster!.expansionZoom : 0;

    const close = clusterCachePoints(villageCluster, Math.ceil(expansion) + 1);
    expect(close.filter((i) => i.kind === 'cluster')).toHaveLength(0);
    expect(close.filter((i) => i.kind === 'point')).toHaveLength(villageCluster.length);
  });

  it('always separates by street level regardless of density', () => {
    // Two caches ~20 m apart — the tightest realistic pairing.
    const tight = [point('x', 52.283, 0.044), point('y', 52.2832, 0.0441)];
    const items = clusterCachePoints(tight, 17);
    expect(items.filter((i) => i.kind === 'point')).toHaveLength(2);
  });

  it('splits the group at the exact zoom the chip tap flies to', () => {
    const cluster = clusterCachePoints(villageCluster, 6).find((i) => i.kind === 'cluster');
    const expansion = cluster!.kind === 'cluster' ? cluster!.expansionZoom : 0;
    const after = clusterCachePoints(villageCluster, expansion);
    // No item at the tap-target zoom still contains all four caches.
    expect(after.some((i) => i.kind === 'cluster' && i.count === villageCluster.length)).toBe(
      false,
    );
  });

  it('never loses a cache at any zoom (leaves + chip counts = input)', () => {
    const all = [...villageCluster, farAway];
    for (let z = 0; z <= 17; z += 1) {
      const items = clusterCachePoints(all, z);
      const total = items.reduce((n, i) => n + (i.kind === 'cluster' ? i.count : 1), 0);
      expect(total).toBe(all.length);
    }
  });

  it('keeps caches beyond the Web-Mercator latitude cutoff', () => {
    const polar = [point('north', 89.9, 10), point('south', -89.9, -10), point('edge', 85.02, 0)];
    const items = clusterCachePoints(polar, 17);
    const ids = items.flatMap((i) => (i.kind === 'point' ? [i.point.id] : []));
    expect(ids.sort()).toEqual(['edge', 'north', 'south']);
  });

  it('caps the expansion zoom for caches at identical coordinates', () => {
    const stacked = [
      point('s1', 52.283, 0.044),
      point('s2', 52.283, 0.044),
      point('s3', 52.283, 0.044),
    ];
    const items = clusterCachePoints(stacked, 6);
    expect(items).toHaveLength(1);
    const [only] = items;
    expect(only.kind === 'cluster' && only.count).toBe(3);
    // Can't ever separate spatially — the tap target is clamped to 17
    // rather than an unbounded zoom.
    expect(only.kind === 'cluster' && only.expansionZoom).toBe(17);
    // At that zoom (past maxZoom) every cache is an individual pin again,
    // stacked on one spot but none dropped.
    const atTarget = clusterCachePoints(stacked, 17);
    expect(atTarget.filter((i) => i.kind === 'point')).toHaveLength(3);
  });

  it('preserves the original point objects on leaves (identity for tap handlers)', () => {
    const items = clusterCachePoints(villageCluster, 18);
    const leaf = items.find((i) => i.kind === 'point');
    expect(leaf && leaf.kind === 'point' && villageCluster.includes(leaf.point)).toBe(true);
  });
});
