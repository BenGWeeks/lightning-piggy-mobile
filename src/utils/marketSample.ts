import type { MarketProduct } from '../data/marketProducts';
export const ROBOTECHY_PUBKEY = '211f325b5396968ac0c79b7c0a030d768206d32ac61f93f143de112b859bd46f';
// One seed for the app process, shared across rail remounts.
const SESSION_SEED = Math.floor(Math.random() * 0x100000000);
export function samplePreferredProducts(
  products: readonly MarketProduct[],
  count = 8,
  seed = SESSION_SEED,
): MarketProduct[] {
  const score = (id: string) => {
    let value = seed >>> 0;
    for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x45d9f3b) >>> 0;
    return value ^ (value >>> 16);
  };
  const sorted = [...products].sort(
    (a, b) => score(a.id) - score(b.id) || a.id.localeCompare(b.id),
  );
  const sample = sorted.slice(0, Math.max(0, count));
  const robotechy = sorted.find((product) => product.listing?.event.pubkey === ROBOTECHY_PUBKEY);
  if (robotechy && sample.length && !sample.includes(robotechy))
    sample[sample.length - 1] = robotechy;
  return sample;
}
