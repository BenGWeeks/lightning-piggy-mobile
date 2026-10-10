import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CURRENCY_PREF_KEY_BASE,
  LOCALE_PREF_KEY_BASE,
  __resetAccountPrefsForTests,
  loadAccountPref,
  peekAccountPref,
  saveAccountPref,
} from './accountDisplayPrefs';
import { perAccountKey } from './perAccountStorage';
import { __resetSafetyMigrationForTests } from './safetySettingsMigration';

jest.mock('./identitiesStore', () => ({
  loadIdentities: jest.fn(async () => ({
    identities: [{ pubkey: 'a'.repeat(64) }, { pubkey: 'b'.repeat(64) }],
    activePubkey: 'a'.repeat(64),
  })),
}));

const BIG = 'a'.repeat(64);
const MIDDLE = 'b'.repeat(64);
const LITTLE = 'c'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetAccountPrefsForTests();
  __resetSafetyMigrationForTests();
});

describe('per-account language and currency', () => {
  it('migrates the phone value into every existing account and keeps it as the new-account template', async () => {
    await AsyncStorage.setItem(LOCALE_PREF_KEY_BASE, 'es');
    await AsyncStorage.setItem(CURRENCY_PREF_KEY_BASE, 'GBP');
    expect(await loadAccountPref(LOCALE_PREF_KEY_BASE, BIG)).toBe('es');
    expect(await AsyncStorage.getItem(perAccountKey(LOCALE_PREF_KEY_BASE, MIDDLE))).toBe('es');
    expect(await AsyncStorage.getItem(perAccountKey(CURRENCY_PREF_KEY_BASE, MIDDLE))).toBe('GBP');
    // A brand-new account starts from the phone's current value.
    expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, LITTLE)).toBe('GBP');
    // Legacy device keys are deleted after copying.
    expect(await AsyncStorage.getItem(LOCALE_PREF_KEY_BASE)).toBeNull();
  });

  it('keeps accounts independent and switches instantly via the sync mirror', async () => {
    await saveAccountPref(LOCALE_PREF_KEY_BASE, 'es', BIG);
    await saveAccountPref(CURRENCY_PREF_KEY_BASE, 'EUR', BIG);
    await saveAccountPref(LOCALE_PREF_KEY_BASE, 'en', MIDDLE);
    await saveAccountPref(CURRENCY_PREF_KEY_BASE, 'GBP', MIDDLE);
    expect(await loadAccountPref(LOCALE_PREF_KEY_BASE, BIG)).toBe('es');
    expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, BIG)).toBe('EUR');
    expect(await loadAccountPref(LOCALE_PREF_KEY_BASE, MIDDLE)).toBe('en');
    expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, MIDDLE)).toBe('GBP');
    expect(peekAccountPref(LOCALE_PREF_KEY_BASE, BIG)).toBe('es');
    expect(peekAccountPref(LOCALE_PREF_KEY_BASE, MIDDLE)).toBe('en');
  });

  it('snapshots the default when nothing is stored anywhere', async () => {
    expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, LITTLE)).toBe('USD');
  });
});

it('snapshots a new account default so later changes by someone else do not follow it', async () => {
  await saveAccountPref(CURRENCY_PREF_KEY_BASE, 'GBP', BIG);
  expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, LITTLE)).toBe('GBP');
  await saveAccountPref(CURRENCY_PREF_KEY_BASE, 'EUR', BIG);
  expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, LITTLE)).toBe('GBP');
});
it('preserves existing default accounts when another account changes first', async () => {
  await saveAccountPref(CURRENCY_PREF_KEY_BASE, 'GBP', BIG);
  expect(await loadAccountPref(CURRENCY_PREF_KEY_BASE, MIDDLE)).toBe('USD');
});
