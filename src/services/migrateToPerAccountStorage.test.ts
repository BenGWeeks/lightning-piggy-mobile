// Unit tests for the one-time per-account storage migration. Three
// invariants matter:
//   1. Idempotent — running twice MUST be a no-op.
//   2. Copy-not-delete — legacy keys remain in place after the copy
//      so a downgrade keeps reading what it expects.
//   3. Skipped when the namespaced slot already holds data (downgrade
//      then re-upgrade case).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetMigrationForTests, migrateToPerAccountStorage } from './migrateToPerAccountStorage';
import { PER_ACCOUNT_STORAGE_BASES, perAccountKey } from './perAccountStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const PK = 'a'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
  await __resetMigrationForTests();
});

describe('migrateToPerAccountStorage', () => {
  it('is a no-op for an empty pubkey', async () => {
    const result = await migrateToPerAccountStorage('');
    expect(result.alreadyDone).toBe(true);
    expect(result.ranSteps).toBe(0);
  });

  it('copies legacy global keys to the namespaced slot on first run', async () => {
    await AsyncStorage.setItem('nostr_groups', JSON.stringify([{ id: 'g1' }]));
    await AsyncStorage.setItem('wallet_list', JSON.stringify([{ id: 'w1' }]));
    const result = await migrateToPerAccountStorage(PK);
    expect(result.alreadyDone).toBe(false);
    expect(result.ranSteps).toBeGreaterThanOrEqual(2);
    expect(await AsyncStorage.getItem(perAccountKey('nostr_groups', PK))).toBe(
      JSON.stringify([{ id: 'g1' }]),
    );
    expect(await AsyncStorage.getItem(perAccountKey('wallet_list', PK))).toBe(
      JSON.stringify([{ id: 'w1' }]),
    );
  });

  it('does NOT delete the legacy keys after copy', async () => {
    await AsyncStorage.setItem('nostr_groups', JSON.stringify([{ id: 'g1' }]));
    await migrateToPerAccountStorage(PK);
    expect(await AsyncStorage.getItem('nostr_groups')).toBe(JSON.stringify([{ id: 'g1' }]));
  });

  it('is idempotent — second call short-circuits', async () => {
    await AsyncStorage.setItem('nostr_groups', JSON.stringify([{ id: 'g1' }]));
    const first = await migrateToPerAccountStorage(PK);
    expect(first.alreadyDone).toBe(false);
    const second = await migrateToPerAccountStorage(PK);
    expect(second.alreadyDone).toBe(true);
    expect(second.ranSteps).toBe(0);
  });

  it('skips bases whose namespaced slot already has data', async () => {
    // Pre-existing namespaced entry simulates a downgrade-then-upgrade:
    // the legacy global is now stale and must NOT clobber the
    // multi-account-aware data.
    await AsyncStorage.setItem('nostr_groups', JSON.stringify([{ id: 'stale' }]));
    await AsyncStorage.setItem(
      perAccountKey('nostr_groups', PK),
      JSON.stringify([{ id: 'fresh' }]),
    );
    await migrateToPerAccountStorage(PK);
    expect(await AsyncStorage.getItem(perAccountKey('nostr_groups', PK))).toBe(
      JSON.stringify([{ id: 'fresh' }]),
    );
  });

  it('skips bases the legacy slot has never held', async () => {
    // No legacy nostr_groups -> namespaced slot stays empty.
    const result = await migrateToPerAccountStorage(PK);
    expect(result.alreadyDone).toBe(false);
    for (const base of PER_ACCOUNT_STORAGE_BASES) {
      const namespaced = perAccountKey(base, PK);
      expect(await AsyncStorage.getItem(namespaced)).toBeNull();
    }
  });
});
