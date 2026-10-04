import { clusterMapPoints } from './mapClusters';

const merchants = [
  { lat: 52.283, lng: 0.044, merchant: { id: 1, icon: 'cafe', lightning: true } },
  { lat: 52.284, lng: 0.046, merchant: { id: 2, icon: 'restaurant', lightning: false } },
  { lat: 52.286, lng: 0.043, merchant: { id: 3, icon: 'store', lightning: true } },
  { lat: 55.676, lng: 12.568, merchant: { id: 4, icon: 'cafe', lightning: true } },
];

it('groups nearby merchants while keeping a distant merchant independent', () => {
  const items = clusterMapPoints(merchants, 6);
  expect(items.filter((item) => item.kind === 'cluster').map((item) => item.count)).toEqual([3]);
  expect(
    items.filter((item) => item.kind === 'point').map((item) => item.point.merchant.id),
  ).toEqual([4]);
});

it('progressively splits at the tap expansion zoom and preserves original merchant metadata', () => {
  const group = clusterMapPoints(merchants, 6).find((item) => item.kind === 'cluster');
  if (!group || group.kind !== 'cluster') throw new Error('Expected merchant cluster');
  const expanded = clusterMapPoints(merchants, group.expansionZoom);
  expect(expanded.some((item) => item.kind === 'cluster' && item.count === 3)).toBe(false);
  const leaves = clusterMapPoints(merchants, 17);
  expect(leaves).toHaveLength(merchants.length);
  for (const leaf of leaves) {
    expect(leaf.kind).toBe('point');
    if (leaf.kind === 'point') expect(merchants).toContain(leaf.point);
  }
});

it('never increases the bounded merchant marker count or drops merchants at any zoom', () => {
  const bounded = Array.from({ length: 250 }, (_, id) => ({
    lat: 52.283 + (id % 25) * 0.002,
    lng: 0.044 + Math.floor(id / 25) * 0.002,
    merchant: { id },
  }));
  for (let zoom = 0; zoom <= 20; zoom += 1) {
    const items = clusterMapPoints(bounded, zoom);
    expect(items.length).toBeLessThanOrEqual(250);
    expect(items.reduce((sum, item) => sum + (item.kind === 'cluster' ? item.count : 1), 0)).toBe(
      250,
    );
  }
});
