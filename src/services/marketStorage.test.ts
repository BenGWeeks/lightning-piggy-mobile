import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearMarketSnapshotMemory,
  getMarketSnapshot,
  readMarketPreferences,
  readMarketSnapshot,
  writeMarketSnapshot,
  MARKET_CACHE_KEY,
  MARKET_CACHE_MAX_AGE_MS,
  MARKET_CACHE_MAX_CHARS,
} from './marketStorage';
beforeEach(() => {
  clearMarketSnapshotMemory();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});
it('rejects corrupt preferences and disabled scopes', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{broken');
  expect((await readMarketPreferences('alice')).mode).toBe('preferred');
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
    JSON.stringify({ mode: 'wotAll', merchant: 42 }),
  );
  expect(await readMarketPreferences('bob')).toEqual({
    mode: 'preferred',
    merchant: null,
    country: null,
    currency: null,
  });
});
it('bounds disk and session scopes and isolates accounts', async () => {
  for (let i = 0; i < 12; i++)
    await writeMarketSnapshot(`alice|${i}`, { products: [], incomplete: false });
  expect(getMarketSnapshot('alice|0')).toBeUndefined();
  expect(getMarketSnapshot('bob|11')).toBeUndefined();
  expect(getMarketSnapshot('alice|11')).toBeDefined();
  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls.filter(
    ([key]) => key === MARKET_CACHE_KEY,
  );
  expect(JSON.parse(writes[writes.length - 1][1]).length).toBeLessThanOrEqual(8);
  expect(writes.every(([, raw]) => raw.length <= MARKET_CACHE_MAX_CHARS)).toBe(true);
});
it('rejects expired, oversized and malformed disk envelopes', async () => {
  for (const raw of [
    JSON.stringify([
      {
        key: 'alice',
        at: Date.now() - MARKET_CACHE_MAX_AGE_MS,
        result: { products: [], incomplete: false },
      },
    ]),
    'x'.repeat(MARKET_CACHE_MAX_CHARS + 1),
    '{broken',
    JSON.stringify([null]),
  ]) {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
    expect(await readMarketSnapshot('alice')).toBeUndefined();
  }
});

it('does not retain an oversized snapshot in either cache', async () => {
  const product = {
    id: 'large',
    sellerName: 'Seller',
    description: 'x'.repeat(MARKET_CACHE_MAX_CHARS),
  } as import('../data/marketProducts').MarketProduct;
  await writeMarketSnapshot('alice|large', { products: [product], incomplete: false });
  expect(getMarketSnapshot('alice|large')).toBeUndefined();
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(MARKET_CACHE_KEY, '[]');
});
