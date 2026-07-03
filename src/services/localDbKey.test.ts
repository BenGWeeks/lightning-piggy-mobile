import { webcrypto } from 'node:crypto';

// crypto.getRandomValues is polyfilled in the app via src/polyfills.ts;
// provide Node's webcrypto here so the key generator runs under jest.
if (!(globalThis as { crypto?: Crypto }).crypto) {
  (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
}

const mockStore = new Map<string, string>();
const mockSetSpy = jest.fn();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string, opts?: unknown) => {
    mockSetSpy(k, v, opts);
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
}));

import * as SecureStore from 'expo-secure-store';
import { getOrCreateLocalDbKey, clearLocalDbKey } from './localDbKey';

const STORE_KEY = 'local_db_key_v1';

beforeEach(async () => {
  mockStore.clear();
  mockSetSpy.mockClear();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(mockStore.get(k) ?? null),
  );
  await clearLocalDbKey(); // reset the single-flight cache between tests
  mockStore.clear();
});

describe('localDbKey', () => {
  it('generates a 256-bit (64-hex-char) key on first call and persists it', async () => {
    const key = await getOrCreateLocalDbKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(mockStore.get(STORE_KEY)).toBe(key);
  });

  it('persists with the device-only keychain option (no iCloud / migration backup)', async () => {
    await getOrCreateLocalDbKey();
    expect(mockSetSpy).toHaveBeenCalledWith(
      STORE_KEY,
      expect.any(String),
      expect.objectContaining({ keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' }),
    );
  });

  it('is idempotent — returns the same key on subsequent calls', async () => {
    const a = await getOrCreateLocalDbKey();
    const b = await getOrCreateLocalDbKey();
    expect(b).toBe(a);
  });

  it('returns the already-persisted key rather than minting a new one', async () => {
    mockStore.set(STORE_KEY, 'a'.repeat(64));
    expect(await getOrCreateLocalDbKey()).toBe('a'.repeat(64));
  });

  it('regenerates + overwrites a corrupted (wrong-length / non-hex) stored value', async () => {
    mockStore.set(STORE_KEY, 'not-a-valid-key');
    const key = await getOrCreateLocalDbKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(mockStore.get(STORE_KEY)).toBe(key);
  });

  it('single-flight: concurrent first-run calls share one generated key', async () => {
    const [a, b] = await Promise.all([getOrCreateLocalDbKey(), getOrCreateLocalDbKey()]);
    expect(a).toBe(b);
  });

  it('clears the cached promise on failure so a later call can retry', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('SecureStore down'));
    await expect(getOrCreateLocalDbKey()).rejects.toThrow('SecureStore down');
    // Retry now that SecureStore is healthy — must not stay wedged on the
    // cached rejection.
    const key = await getOrCreateLocalDbKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('clearLocalDbKey deletes the stored key; a later call mints a fresh one', async () => {
    const first = await getOrCreateLocalDbKey();
    await clearLocalDbKey();
    expect(mockStore.get(STORE_KEY)).toBeUndefined();
    const second = await getOrCreateLocalDbKey();
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
  });
});
