import { MARKET_PRODUCTS } from '../data/marketProducts';
import { samplePreferredProducts, ROBOTECHY_PUBKEY } from './marketSample';
const products = Array.from({ length: 30 }, (_, i) => ({ ...MARKET_PRODUCTS[0], id: `live-${i}` }));
const robot = {
  ...products[0],
  id: 'robotechy',
  listing: { event: { pubkey: ROBOTECHY_PUBKEY } },
} as (typeof products)[number];
it('always includes a Robotechy listing even when its seeded rank misses the rail', () => {
  for (let seed = 0; seed < 30; seed++) {
    const sampled = samplePreferredProducts([...products, robot], 8, seed);
    expect(sampled).toHaveLength(8);
    expect(sampled).toContain(robot);
    expect(new Set(sampled.map((product) => product.id)).size).toBe(8);
  }
});
it('is stable across calls and source reordering within the app session', () => {
  expect(samplePreferredProducts(products)).toEqual(
    samplePreferredProducts([...products].reverse()),
  );
  expect(samplePreferredProducts(products, 8, 1)).not.toEqual(
    samplePreferredProducts(products, 8, 2),
  );
  expect(products[0].id).toBe('live-0');
});
it('handles an empty catalogue, small catalogue and zero-sized rail', () => {
  expect(samplePreferredProducts([])).toEqual([]);
  expect(samplePreferredProducts([robot])).toEqual([robot]);
  expect(samplePreferredProducts([robot], 0)).toEqual([]);
});
