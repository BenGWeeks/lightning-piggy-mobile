import AsyncStorage from '@react-native-async-storage/async-storage';

import { perAccountKey } from './perAccountStorage';
import { getSendThreshold, setSendThreshold } from './sendThresholdService';
import { loadSecretMode, saveSecretMode } from './secretModeService';
import { loadWotSettings, peekWotSettings, saveWotSettings } from './wotSettingsService';
import { __resetAccountSettingsCacheForTests } from './accountSettingsCache';
import {
  __resetForTests as resetLinkPreview,
  getLinkPreviewEnabled,
  setLinkPreviewEnabled,
} from './linkPreviewPreference';
import { wipeAccountCaches } from '../contexts/accountCacheWipe';
import {
  __resetSafetyMigrationForTests,
  ensureSafetySettingsMigrated,
  migrateSafetySettingsToPerAccount,
  SAFETY_MIGRATION_DONE_KEY,
  SAFETY_SETTING_BASES,
} from './safetySettingsMigration';
import { PER_ACCOUNT_STORAGE_BASES } from './perAccountStorage';
import {
  CURRENCY_PREF_KEY_BASE,
  LOCALE_PREF_KEY_BASE,
  saveAccountPref,
} from './accountDisplayPrefs';

const mockLoadIdentities = jest.fn();
jest.mock('./identitiesStore', () => ({ loadIdentities: () => mockLoadIdentities() }));
jest.mock('./walletStorageService', () => ({
  deleteNwcUrl: jest.fn(),
  deleteXpub: jest.fn(),
  deleteMnemonic: jest.fn(),
  deleteWalletCaches: jest.fn(),
  bestEffortMultiRemove: jest.fn(async (keys: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require('@react-native-async-storage/async-storage').multiRemove(keys);
  }),
  BLOSSOM_SERVERS_PUBLISHED_KEY_BASE: 'blossom_pub',
  BLOSSOM_SERVERS_CREATED_AT_KEY_BASE: 'blossom_created',
}));
jest.mock('../contexts/dmAccountWipe', () => ({ wipeDmStoresForAccount: jest.fn() }));
jest.mock('../services/nostrPlacesStorage', () => ({ clearCacheStorage: jest.fn() }));
jest.mock('../services/notificationHistory', () => ({ clearNotificationHistory: jest.fn() }));

const BIG = 'a'.repeat(64);
const MIDDLE = 'b'.repeat(64);
const LITTLE = 'c'.repeat(64);
const registry = (...pks: string[]) => ({
  identities: pks.map((pubkey) => ({ pubkey })),
  activePubkey: pks[0] ?? null,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSafetyMigrationForTests();
  resetLinkPreview();
  __resetAccountSettingsCacheForTests();
  mockLoadIdentities.mockReset();
  mockLoadIdentities.mockResolvedValue(registry(BIG, MIDDLE));
});

describe('migrateSafetySettingsToPerAccount', () => {
  it('copies each device value to every account then deletes the device key', async () => {
    await AsyncStorage.setItem('send_threshold_sats_v1', '50000');
    await AsyncStorage.setItem('@lp:wot-settings:v1', JSON.stringify({ wotTier: 'friends' }));
    await AsyncStorage.setItem('secret_mode', 'true');
    await AsyncStorage.setItem('link_preview_enabled_v1', 'false');

    await migrateSafetySettingsToPerAccount([BIG, MIDDLE]);

    for (const pk of [BIG, MIDDLE]) {
      expect(await AsyncStorage.getItem(perAccountKey('send_threshold_sats_v1', pk))).toBe('50000');
      expect(await AsyncStorage.getItem(perAccountKey('@lp:wot-settings:v1', pk))).toBe(
        JSON.stringify({ wotTier: 'friends' }),
      );
      expect(await AsyncStorage.getItem(perAccountKey('secret_mode', pk))).toBe('true');
      expect(await AsyncStorage.getItem(perAccountKey('link_preview_enabled_v1', pk))).toBe(
        'false',
      );
    }
    for (const base of SAFETY_SETTING_BASES) expect(await AsyncStorage.getItem(base)).toBeNull();
  });

  it('is idempotent and never overwrites an account that already has a value', async () => {
    await AsyncStorage.setItem('send_threshold_sats_v1', '50000');
    await AsyncStorage.setItem(perAccountKey('send_threshold_sats_v1', MIDDLE), 'off');
    await migrateSafetySettingsToPerAccount([BIG, MIDDLE]);
    await migrateSafetySettingsToPerAccount([BIG, MIDDLE]);
    expect(await AsyncStorage.getItem(perAccountKey('send_threshold_sats_v1', BIG))).toBe('50000');
    expect(await AsyncStorage.getItem(perAccountKey('send_threshold_sats_v1', MIDDLE))).toBe('off');
  });

  it('is safe if interrupted: the device key survives until every copy is written', async () => {
    await AsyncStorage.setItem('secret_mode', 'true');
    const set = AsyncStorage.setItem as jest.Mock;
    const real = set.getMockImplementation() as (k: string, v: string) => Promise<void>;
    set.mockImplementationOnce(real); // first copy lands
    set.mockImplementationOnce(async () => {
      throw new Error('crash'); // second copy dies mid-migration
    });
    await expect(migrateSafetySettingsToPerAccount([BIG, MIDDLE])).rejects.toThrow('crash');
    expect(await AsyncStorage.getItem('secret_mode')).toBe('true');
    await migrateSafetySettingsToPerAccount([BIG, MIDDLE]);
    expect(await AsyncStorage.getItem(perAccountKey('secret_mode', BIG))).toBe('true');
    expect(await AsyncStorage.getItem(perAccountKey('secret_mode', MIDDLE))).toBe('true');
    expect(await AsyncStorage.getItem('secret_mode')).toBeNull();
  });

  it('keeps the device key when there is no account to copy it to yet', async () => {
    await AsyncStorage.setItem('secret_mode', 'true');
    await migrateSafetySettingsToPerAccount([]);
    expect(await AsyncStorage.getItem('secret_mode')).toBe('true');
  });

  it('a new account added after migration starts from the safe defaults', async () => {
    await AsyncStorage.setItem('send_threshold_sats_v1', 'off');
    await AsyncStorage.setItem('secret_mode', 'true');
    await ensureSafetySettingsMigrated(BIG);
    expect(await getSendThreshold(LITTLE)).toBe(10_000);
    expect(await loadSecretMode(LITTLE)).toBe(false);
    expect((await loadWotSettings(LITTLE)).wotTier).toBe('all');
    expect(await getLinkPreviewEnabled(LITTLE)).toBe(true);
    // ...while the accounts that existed inherit the old device value.
    expect(await getSendThreshold(BIG)).toBeNull();
    expect(await loadSecretMode(MIDDLE)).toBe(true);
  });
});

describe('per-account read/write and switching', () => {
  it('keeps each account independent when the active account changes', async () => {
    await setSendThreshold(100_000, BIG);
    await setSendThreshold(null, MIDDLE);
    await saveSecretMode(true, BIG);
    await saveWotSettings({ wotTier: 'friends' }, MIDDLE);
    await setLinkPreviewEnabled(false, BIG);

    expect(await getSendThreshold(BIG)).toBe(100_000);
    expect(await getSendThreshold(MIDDLE)).toBeNull();
    expect(await loadSecretMode(BIG)).toBe(true);
    expect(await loadSecretMode(MIDDLE)).toBe(false);
    expect((await loadWotSettings(BIG)).wotTier).toBe('all');
    expect((await loadWotSettings(MIDDLE)).wotTier).toBe('friends');
    expect(await getLinkPreviewEnabled(BIG)).toBe(false);
    expect(await getLinkPreviewEnabled(MIDDLE)).toBe(true);
  });

  it('is registered in PER_ACCOUNT_STORAGE_BASES', () => {
    for (const base of SAFETY_SETTING_BASES) expect(PER_ACCOUNT_STORAGE_BASES).toContain(base);
  });
});

describe('sign-out wipe', () => {
  it("removes only the signed-out account's safety settings", async () => {
    await setSendThreshold(100_000, BIG);
    await saveSecretMode(true, BIG);
    await saveWotSettings({ wotTier: 'friends' }, BIG);
    await setLinkPreviewEnabled(false, BIG);
    await setSendThreshold(null, MIDDLE);
    await saveSecretMode(true, MIDDLE);
    await saveWotSettings({ wotTier: 'fof' }, MIDDLE);
    await setLinkPreviewEnabled(false, MIDDLE);

    await saveAccountPref(LOCALE_PREF_KEY_BASE, 'es', BIG);
    await saveAccountPref(CURRENCY_PREF_KEY_BASE, 'EUR', BIG);
    await saveAccountPref(LOCALE_PREF_KEY_BASE, 'uk', MIDDLE);

    await wipeAccountCaches(BIG);

    expect(await AsyncStorage.getItem(perAccountKey(LOCALE_PREF_KEY_BASE, BIG))).toBeNull();
    expect(await AsyncStorage.getItem(perAccountKey(CURRENCY_PREF_KEY_BASE, BIG))).toBeNull();
    expect(await AsyncStorage.getItem(perAccountKey(LOCALE_PREF_KEY_BASE, MIDDLE))).toBe('uk');

    expect(await getSendThreshold(BIG)).toBe(10_000);
    expect(await loadSecretMode(BIG)).toBe(false);
    expect((await loadWotSettings(BIG)).wotTier).toBe('all');
    expect(await getLinkPreviewEnabled(BIG)).toBe(true);
    expect(await getSendThreshold(MIDDLE)).toBeNull();
    expect(await loadSecretMode(MIDDLE)).toBe(true);
    expect((await loadWotSettings(MIDDLE)).wotTier).toBe('fof');
    expect(await getLinkPreviewEnabled(MIDDLE)).toBe(false);
  });
});

it('preserves pre-rename dev_mode for every existing account', async () => {
  await AsyncStorage.setItem('dev_mode', 'true');
  await migrateSafetySettingsToPerAccount([BIG, MIDDLE]);
  expect(await loadSecretMode(BIG)).toBe(true);
  expect(await loadSecretMode(MIDDLE)).toBe(true);
  expect(await AsyncStorage.getItem('dev_mode')).toBeNull();
  expect(await AsyncStorage.getItem('secret_mode')).toBeNull();
});
it('does not write a new preference over a failed migration', async () => {
  await AsyncStorage.setItem('send_threshold_sats_v1', '50000');
  mockLoadIdentities.mockRejectedValueOnce(new Error('locked registry'));
  await expect(setSendThreshold(1000, BIG)).rejects.toThrow('locked registry');
  expect(await getSendThreshold(MIDDLE)).toBe(50000);
});

describe('ensureSafetySettingsMigrated', () => {
  it('persists a done flag so later launches skip the copy', async () => {
    await AsyncStorage.setItem('secret_mode', 'true');
    await ensureSafetySettingsMigrated(BIG);
    expect(await AsyncStorage.getItem(SAFETY_MIGRATION_DONE_KEY)).toBe('true');
    // Next launch: a stray device value (e.g. an old build wrote one) is NOT
    // fanned out again — the migration really is one-time.
    __resetSafetyMigrationForTests();
    await AsyncStorage.setItem('send_threshold_sats_v1', 'off');
    await ensureSafetySettingsMigrated(BIG);
    expect(await AsyncStorage.getItem(perAccountKey('send_threshold_sats_v1', BIG))).toBeNull();
  });

  it('keeps the legacy device keys when the identity registry is empty', async () => {
    mockLoadIdentities.mockResolvedValue(registry());
    await AsyncStorage.setItem('@lp:wot-settings:v1', JSON.stringify({ wotTier: 'friends' }));
    await AsyncStorage.setItem('link_preview_enabled_v1', 'false');
    await ensureSafetySettingsMigrated(BIG);
    // The caller's account inherits the old values...
    expect((await loadWotSettings(BIG)).wotTier).toBe('friends');
    // ...but the device keys survive and the run is not marked done, so
    // accounts we couldn't see yet don't fall back to the wider defaults.
    expect(await AsyncStorage.getItem('@lp:wot-settings:v1')).not.toBeNull();
    expect(await AsyncStorage.getItem('link_preview_enabled_v1')).toBe('false');
    expect(await AsyncStorage.getItem(SAFETY_MIGRATION_DONE_KEY)).toBeNull();
    // Next launch, with the registry readable: Middle inherits, then cleanup.
    __resetSafetyMigrationForTests();
    mockLoadIdentities.mockResolvedValue(registry(BIG, MIDDLE));
    await ensureSafetySettingsMigrated(BIG);
    expect((await loadWotSettings(MIDDLE)).wotTier).toBe('friends');
    expect(await getLinkPreviewEnabled(MIDDLE)).toBe(false);
    expect(await AsyncStorage.getItem('@lp:wot-settings:v1')).toBeNull();
    expect(await AsyncStorage.getItem(SAFETY_MIGRATION_DONE_KEY)).toBe('true');
  });

  it("prewarms every registered account's trust tier for an instant, gated-correct switch", async () => {
    await saveWotSettings({ wotTier: 'friends' }, MIDDLE);
    __resetAccountSettingsCacheForTests();
    __resetSafetyMigrationForTests(); // cold start
    expect(peekWotSettings(MIDDLE)).toBeNull();
    await loadWotSettings(BIG); // only the active account is loaded
    expect(peekWotSettings(MIDDLE)).toEqual({ wotTier: 'friends' });
    expect(peekWotSettings(BIG)).toEqual({ wotTier: 'all' });
  });

  it('sign-out forgets the account in the sync mirror', async () => {
    await saveWotSettings({ wotTier: 'friends' }, BIG);
    await wipeAccountCaches(BIG);
    expect(peekWotSettings(BIG)).toBeNull();
  });
});
