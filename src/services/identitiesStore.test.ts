// Unit tests for the multi-account identity registry. Mocks
// expo-secure-store with an in-memory map so the round-trip
// shape (identities + activePubkey) can be asserted without touching
// the OS keychain.

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __resetForTests: () => store.clear(),
  };
});

import * as SecureStore from 'expo-secure-store';
import {
  loadIdentities,
  upsertIdentity,
  removeIdentity,
  setActiveIdentity,
  clearIdentities,
} from './identitiesStore';

const PK1 = 'a'.repeat(64);
const PK2 = 'b'.repeat(64);

beforeEach(() => {
  // The mock factory above exposes __resetForTests on the module object.
  (SecureStore as unknown as { __resetForTests: () => void }).__resetForTests();
});

describe('identitiesStore', () => {
  it('returns empty + null active for a fresh store', async () => {
    const blob = await loadIdentities();
    expect(blob.identities).toEqual([]);
    expect(blob.activePubkey).toBeNull();
  });

  it('upsertIdentity adds + activates a new identity', async () => {
    const blob = await upsertIdentity({
      pubkey: PK1,
      signerType: 'nsec',
      nsec: 'nsec1xxx',
      lastUsedAt: 1000,
    });
    expect(blob.identities).toHaveLength(1);
    expect(blob.identities[0].pubkey).toBe(PK1);
    expect(blob.activePubkey).toBe(PK1);
  });

  it('upsertIdentity round-trips through SecureStore', async () => {
    await upsertIdentity({
      pubkey: PK1,
      signerType: 'nsec',
      nsec: 'nsec1xxx',
      lastUsedAt: 1000,
    });
    const reloaded = await loadIdentities();
    expect(reloaded.identities).toHaveLength(1);
    expect(reloaded.identities[0].pubkey).toBe(PK1);
    expect(reloaded.identities[0].nsec).toBe('nsec1xxx');
    expect(reloaded.activePubkey).toBe(PK1);
  });

  it('upsertIdentity updates an existing identity in place', async () => {
    await upsertIdentity({
      pubkey: PK1,
      signerType: 'nsec',
      nsec: 'nsec1xxx',
      lastUsedAt: 1000,
    });
    const blob = await upsertIdentity({
      pubkey: PK1,
      signerType: 'nsec',
      nsec: 'nsec1yyy',
      lastUsedAt: 2000,
    });
    expect(blob.identities).toHaveLength(1);
    expect(blob.identities[0].nsec).toBe('nsec1yyy');
  });

  it('upsertIdentity supports amber identities (no nsec)', async () => {
    const blob = await upsertIdentity({
      pubkey: PK2,
      signerType: 'amber',
      lastUsedAt: 1000,
    });
    expect(blob.identities[0].signerType).toBe('amber');
    expect(blob.identities[0].nsec).toBeUndefined();
  });

  it('removeIdentity drops the entry and picks a successor', async () => {
    await upsertIdentity({ pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 1 });
    await upsertIdentity({ pubkey: PK2, signerType: 'amber', lastUsedAt: 2 });
    // PK2 is now active. Remove PK2 — successor must be PK1.
    const blob = await removeIdentity(PK2);
    expect(blob.identities).toHaveLength(1);
    expect(blob.identities[0].pubkey).toBe(PK1);
    expect(blob.activePubkey).toBe(PK1);
  });

  it('removeIdentity drops the entry and leaves active alone for a non-active removal', async () => {
    await upsertIdentity({ pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 1 });
    await upsertIdentity({ pubkey: PK2, signerType: 'amber', lastUsedAt: 2 });
    // PK2 active. Remove the non-active PK1 — PK2 stays active.
    const blob = await removeIdentity(PK1);
    expect(blob.identities).toHaveLength(1);
    expect(blob.activePubkey).toBe(PK2);
  });

  it('removeIdentity yields null active when the registry empties', async () => {
    await upsertIdentity({ pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 1 });
    const blob = await removeIdentity(PK1);
    expect(blob.identities).toEqual([]);
    expect(blob.activePubkey).toBeNull();
  });

  it('setActiveIdentity flips the active flag and bumps lastUsedAt', async () => {
    await upsertIdentity({ pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 100 });
    await upsertIdentity({ pubkey: PK2, signerType: 'amber', lastUsedAt: 200 });
    const before = Date.now();
    const blob = await setActiveIdentity(PK1);
    expect(blob.activePubkey).toBe(PK1);
    const pk1 = blob.identities.find((i) => i.pubkey === PK1)!;
    expect(pk1.lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  it('setActiveIdentity is a no-op for unknown pubkeys', async () => {
    await upsertIdentity({ pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 1 });
    const blob = await setActiveIdentity(PK2);
    expect(blob.activePubkey).toBe(PK1);
  });

  it('clearIdentities wipes the registry entirely', async () => {
    await upsertIdentity({ pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 1 });
    await clearIdentities();
    const blob = await loadIdentities();
    expect(blob.identities).toEqual([]);
    expect(blob.activePubkey).toBeNull();
  });

  it('rejects malformed entries on parse', async () => {
    // Hand-write a corrupt blob into SecureStore — only the valid
    // entry survives the parseBlob filter.
    await SecureStore.setItemAsync(
      'identities_v1',
      JSON.stringify({
        identities: [
          { pubkey: PK1, signerType: 'nsec', nsec: 'a', lastUsedAt: 1 },
          { pubkey: 'not-hex', signerType: 'nsec', nsec: 'b', lastUsedAt: 2 },
          { pubkey: PK2, signerType: 'unknown' },
        ],
        activePubkey: PK1,
      }),
    );
    const blob = await loadIdentities();
    expect(blob.identities).toHaveLength(1);
    expect(blob.identities[0].pubkey).toBe(PK1);
  });
});
