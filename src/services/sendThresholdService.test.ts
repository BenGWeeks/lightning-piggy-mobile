/**
 * Unit tests for the high-value send confirmation threshold (issue #82).
 *
 * Two surfaces under test:
 *   1. `shouldConfirmSend(amount, threshold)` — pure decision function.
 *   2. `getSendThreshold` / `setSendThreshold` — AsyncStorage round-trip,
 *      including the "new install inherits default" + "Off sentinel" paths.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY,
  getSendThreshold,
  setSendThreshold,
  shouldConfirmSend,
} from './sendThresholdService';
import { perAccountKey } from './perAccountStorage';
import { __resetSafetyMigrationForTests } from './safetySettingsMigration';

jest.mock('./identitiesStore', () => ({
  loadIdentities: jest.fn(async () => ({ identities: [], activePubkey: null })),
}));

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('shouldConfirmSend', () => {
  it('prompts when amount equals the threshold', () => {
    expect(shouldConfirmSend(10_000, 10_000)).toBe(true);
  });

  it('prompts when amount exceeds the threshold', () => {
    expect(shouldConfirmSend(50_000, 10_000)).toBe(true);
  });

  it('does not prompt when amount is below the threshold', () => {
    expect(shouldConfirmSend(9_999, 10_000)).toBe(false);
  });

  it('does not prompt when threshold is null (Off)', () => {
    expect(shouldConfirmSend(1_000_000, null)).toBe(false);
  });

  it('does not prompt for zero / negative amounts', () => {
    expect(shouldConfirmSend(0, 10_000)).toBe(false);
    expect(shouldConfirmSend(-1, 10_000)).toBe(false);
  });

  it('does not prompt for non-finite inputs', () => {
    expect(shouldConfirmSend(NaN, 10_000)).toBe(false);
    expect(shouldConfirmSend(Infinity, 10_000)).toBe(false);
    expect(shouldConfirmSend(50_000, NaN)).toBe(false);
  });
});

describe('getSendThreshold / setSendThreshold', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetSafetyMigrationForTests();
  });

  it("is per account: one account's choice never changes another's", async () => {
    await setSendThreshold(50_000, PK);
    await expect(getSendThreshold(PK)).resolves.toBe(50_000);
    await expect(getSendThreshold(OTHER)).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
    await setSendThreshold(null, OTHER);
    await expect(getSendThreshold(OTHER)).resolves.toBeNull();
    await expect(getSendThreshold(PK)).resolves.toBe(50_000);
  });

  it('confirms at the default when there is no active account', async () => {
    await expect(getSendThreshold(null)).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
  });

  it('returns the default for a new install (unwritten key)', async () => {
    await expect(getSendThreshold(PK)).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
  });

  it('round-trips a custom integer threshold', async () => {
    await setSendThreshold(50_000, PK);
    await expect(getSendThreshold(PK)).resolves.toBe(50_000);
  });

  it('returns null when the user has chosen Off', async () => {
    await setSendThreshold(null, PK);
    await expect(getSendThreshold(PK)).resolves.toBeNull();
  });

  it('preserves an explicit user choice across a re-read (no surprise default)', async () => {
    await setSendThreshold(100_000, PK);
    // Mimic a relaunch by reading twice — value must stick, not revert to default.
    await expect(getSendThreshold(PK)).resolves.toBe(100_000);
    await expect(getSendThreshold(PK)).resolves.toBe(100_000);
  });

  it('falls back to default if the stored value is corrupt', async () => {
    await AsyncStorage.setItem(
      perAccountKey(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, PK),
      'not-a-number',
    );
    await expect(getSendThreshold(PK)).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
  });

  it('rejects setting a non-positive threshold', async () => {
    await expect(setSendThreshold(0, PK)).rejects.toThrow();
    await expect(setSendThreshold(-100, PK)).rejects.toThrow();
  });

  it('rejects fractional thresholds that floor to 0', async () => {
    // Pre-fix bug: floored to 0, then validated against pre-floor value (0.5 > 0) and silently stored 0.
    await expect(setSendThreshold(0.5, PK)).rejects.toThrow();
  });

  it('floors fractional thresholds that floor to a positive integer', async () => {
    await setSendThreshold(10500.7, PK);
    await expect(getSendThreshold(PK)).resolves.toBe(10500);
  });
});
