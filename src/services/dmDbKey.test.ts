import { webcrypto } from 'node:crypto';

// crypto.getRandomValues is polyfilled in the app via src/polyfills.ts;
// provide Node's webcrypto here so the key generator runs under jest.
if (!(globalThis as { crypto?: Crypto }).crypto) {
  (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
}

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
}));

import { getOrCreateDmDbKey, clearDmDbKey } from './dmDbKey';

beforeEach(async () => {
  mockStore.clear();
  await clearDmDbKey(); // reset the single-flight cache between tests
  mockStore.clear();
});

describe('dmDbKey', () => {
  it('generates a 256-bit (64-hex-char) key on first call and persists it', async () => {
    const key = await getOrCreateDmDbKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(mockStore.get('dm_db_key_v1')).toBe(key);
  });

  it('is idempotent — returns the same key on subsequent calls', async () => {
    const a = await getOrCreateDmDbKey();
    const b = await getOrCreateDmDbKey();
    expect(b).toBe(a);
  });

  it('returns the already-persisted key rather than minting a new one', async () => {
    mockStore.set('dm_db_key_v1', 'a'.repeat(64));
    expect(await getOrCreateDmDbKey()).toBe('a'.repeat(64));
  });

  it('single-flight: concurrent first-run calls share one generated key', async () => {
    const [a, b] = await Promise.all([getOrCreateDmDbKey(), getOrCreateDmDbKey()]);
    expect(a).toBe(b);
  });

  it('clearDmDbKey deletes the stored key; a later call mints a fresh one', async () => {
    const first = await getOrCreateDmDbKey();
    await clearDmDbKey();
    expect(mockStore.get('dm_db_key_v1')).toBeUndefined();
    const second = await getOrCreateDmDbKey();
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
  });
});
