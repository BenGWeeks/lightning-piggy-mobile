import { clusterMapPoints } from './mapClusters';

interface TestPoint {
  id: string;
  lat: number;
  lng: number;
}

const point = (id: string, lat: number, lng: number): TestPoint => ({ id, lat, lng });

// Longstanton's Piglets sit within ~1 km of each other; a village-scale
// test spread of ~0.005° ≈ 500 m.
const villageCluster = [
  point('a', 52.283, 0.044),
  point('b', 52.284, 0.046),
  point('c', 52.286, 0.043),
  point('d', 52.281, 0.048),
];
const farAway = point('copenhagen', 55.676, 12.568);

describe('clusterMapPoints', () => {
  it('returns an empty array for no points', () => {
    expect(clusterMapPoints([], 10)).toEqual([]);
  });

  it('groups co-located pins into one count chip at a wide zoom', () => {
    const items = clusterMapPoints([...villageCluster, farAway], 6);
    const clusters = items.filter((i) => i.kind === 'cluster');
    const leaves = items.filter((i) => i.kind === 'point');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind === 'cluster' && clusters[0].count).toBe(4);
    // The far-away pin stays individual.
    expect(leaves.map((l) => (l.kind === 'point' ? l.point.id : ''))).toEqual(['copenhagen']);
  });

  it('separates every pin once zoomed past the expansion zoom', () => {
    const wide = clusterMapPoints(villageCluster, 6);
    const cluster = wide.find((i) => i.kind === 'cluster');
    expect(cluster).toBeDefined();
    const expansion = cluster!.kind === 'cluster' ? cluster!.expansionZoom : 0;

    const close = clusterMapPoints(villageCluster, Math.ceil(expansion) + 1);
    expect(close.filter((i) => i.kind === 'cluster')).toHaveLength(0);
    expect(close.filter((i) => i.kind === 'point')).toHaveLength(villageCluster.length);
  });

  it('always separates by street level regardless of density', () => {
    // Two pins ~20 m apart — the tightest realistic pairing.
    const tight = [point('x', 52.283, 0.044), point('y', 52.2832, 0.0441)];
    const items = clusterMapPoints(tight, 17);
    expect(items.filter((i) => i.kind === 'point')).toHaveLength(2);
  });

  it('preserves the original point objects on leaves (identity for tap handlers)', () => {
    const items = clusterMapPoints(villageCluster, 18);
    const leaf = items.find((i) => i.kind === 'point');
    expect(leaf && leaf.kind === 'point' && villageCluster.includes(leaf.point)).toBe(true);
  });
});
