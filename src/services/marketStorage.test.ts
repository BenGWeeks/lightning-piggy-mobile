import * as pacing from '../contexts/nostrDecryptPacing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearMarketSnapshotMemory,
  getMarketSnapshot,
  loadedMarketSnapshots,
  readMarketPreferences,
  writeMarketPreferences,
  wipeMarketAccount,
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
  } as unknown as import('../data/marketProducts').MarketProduct;
  await writeMarketSnapshot('alice|large', { products: [product], incomplete: false });
  expect(getMarketSnapshot('alice|large')).toBeUndefined();
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(MARKET_CACHE_KEY, '[]');
});

it('filters signed expiration from memory and disk without expiring the snapshot', async () => {
  const product = {
    id: 'expires',
    sellerName: 'Seller',
    listing: {
      event: {
        pubkey: 'seller',
        tags: [['expiration', String(Math.floor(Date.now() / 1000) + 60)]],
      },
      vendor: {},
    },
  } as unknown as import('../data/marketProducts').MarketProduct;
  await writeMarketSnapshot('expiry|scope', { products: [product], incomplete: false });
  const raw = (AsyncStorage.setItem as jest.Mock).mock.calls
    .filter(([key]) => key === MARKET_CACHE_KEY)
    .pop()[1];
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
  try {
    expect(getMarketSnapshot('expiry|scope')?.result.products).toEqual([]);
    clearMarketSnapshotMemory();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
    expect((await readMarketSnapshot('expiry|scope'))?.result.products).toEqual([]);
  } finally {
    clock.mockRestore();
  }
});

it('invalidates pending snapshot and preference reads during account cleanup', async () => {
  let release!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const snapshotRead = readMarketSnapshot('read-race|scope');
  await Promise.resolve();
  await Promise.resolve();
  const wipe = wipeMarketAccount('read-race');
  release(
    JSON.stringify([
      { key: 'read-race|scope', at: Date.now(), result: { products: [], incomplete: false } },
    ]),
  );
  await wipe;
  expect(await snapshotRead).toBeUndefined();
  expect(getMarketSnapshot('read-race|scope')).toBeUndefined();

  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const preferencesRead = readMarketPreferences('read-race');
  await Promise.resolve();
  await Promise.resolve();
  const secondWipe = wipeMarketAccount('read-race');
  release(JSON.stringify({ mode: 'wotFriends', merchant: 'Private seller' }));
  await secondWipe;
  expect((await preferencesRead).merchant).toBeNull();
});

it('cancels queued writes before removing account data', async () => {
  const prefs = writeMarketPreferences('write-race', {
    mode: 'wotFriends',
    merchant: 'Seller',
    country: null,
    currency: null,
  });
  const snapshot = writeMarketSnapshot('write-race|scope', { products: [], incomplete: false });
  await wipeMarketAccount('write-race');
  await Promise.all([prefs, snapshot]);
  expect(getMarketSnapshot('write-race|scope')).toBeUndefined();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('market_filters_v1_write-race');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(MARKET_CACHE_KEY);
});

it('rejects oversized event payloads before any synchronous serialization', async () => {
  const product = {
    id: 'huge',
    sellerName: 'Seller',
    listing: {
      event: { pubkey: 'seller', content: 'x'.repeat(MARKET_CACHE_MAX_CHARS), tags: [] },
      vendor: {},
    },
  } as unknown as import('../data/marketProducts').MarketProduct;
  const stringify = jest.spyOn(JSON, 'stringify');
  try {
    const write = writeMarketSnapshot('payload|scope', { products: [product], incomplete: false });
    expect(stringify).not.toHaveBeenCalled();
    await write;
    expect(stringify.mock.calls.some(([value]) => value === product)).toBe(false);
    expect(getMarketSnapshot('payload|scope')).toBeUndefined();
  } finally {
    stringify.mockRestore();
  }
});

it('paces bounded serialization per product and disposes the preparation scheduler', async () => {
  const maybeYield = jest.fn(async () => {});
  const dispose = jest.fn();
  const scheduler = jest
    .spyOn(pacing, 'createYieldScheduler')
    .mockReturnValue({ maybeYield, dispose, yieldCount: 0 });
  try {
    const products = Array.from({ length: 250 }, (_, i) => ({
      id: String(i),
      sellerName: 'Seller',
      description: 'x'.repeat(2000),
    })) as unknown as import('../data/marketProducts').MarketProduct[];
    await writeMarketSnapshot('paced|scope', { products, incomplete: false });
    expect(scheduler).toHaveBeenCalledWith({ safetyEvery: 32, coldStart: true });
    expect(maybeYield).toHaveBeenCalledTimes(250);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getMarketSnapshot('paced|scope')?.result.products).toHaveLength(250);
  } finally {
    scheduler.mockRestore();
  }
});

it('drains a write already in disk storage before removing it', async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        started();
      }),
  );
  const pending = writeMarketPreferences('inflight', {
    mode: 'wotFriends',
    merchant: 'Seller',
    country: null,
    currency: null,
  });
  await entered;
  const wipe = wipeMarketAccount('inflight');
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  release();
  await Promise.all([pending, wipe]);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('market_filters_v1_inflight');
});

it('blocks a late relay write after cleanup until a new account hydration', async () => {
  await wipeMarketAccount('late-relay');
  jest.clearAllMocks();
  await writeMarketSnapshot('late-relay|scope', { products: [], incomplete: false });
  await writeMarketPreferences('late-relay', {
    mode: 'wotFriends',
    merchant: 'Seller',
    country: null,
    currency: null,
  });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(getMarketSnapshot('late-relay|scope')).toBeUndefined();
  await readMarketPreferences('late-relay');
  await writeMarketSnapshot('late-relay|scope', { products: [], incomplete: false });
  expect(getMarketSnapshot('late-relay|scope')).toBeDefined();
});
it('lists in-memory snapshots for the requested accounts only', async () => {
  const product = { id: 'p1', sellerName: 'shop' } as never;
  await writeMarketSnapshot('alice|x|r', { products: [product], incomplete: false });
  await writeMarketSnapshot('team|y|r', { products: [], incomplete: false });
  await writeMarketSnapshot('bob|z|r', { products: [product], incomplete: false });
  const loaded = loadedMarketSnapshots(['alice', 'team']);
  expect(loaded.map((s) => s.account).sort()).toEqual(['alice', 'team']);
  expect(loaded.find((s) => s.account === 'alice')?.products).toEqual([product]);
  await wipeMarketAccount('alice');
  expect(loadedMarketSnapshots(['alice'])).toEqual([]);
});
