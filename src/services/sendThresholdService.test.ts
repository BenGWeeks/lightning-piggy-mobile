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
  initialiseSendThresholdForNewInstall,
} from './sendThresholdService';

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
  });

  it('returns the default for a new install (unwritten key)', async () => {
    await expect(getSendThreshold()).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
  });

  it('round-trips a custom integer threshold', async () => {
    await setSendThreshold(50_000);
    await expect(getSendThreshold()).resolves.toBe(50_000);
  });

  it('returns null when the user has chosen Off', async () => {
    await setSendThreshold(null);
    await expect(getSendThreshold()).resolves.toBeNull();
  });

  it('preserves an explicit user choice across a re-read (no surprise default)', async () => {
    await setSendThreshold(100_000);
    // Mimic a relaunch by reading twice — value must stick, not revert to default.
    await expect(getSendThreshold()).resolves.toBe(100_000);
    await expect(getSendThreshold()).resolves.toBe(100_000);
  });

  it('falls back to default if the stored value is corrupt', async () => {
    await AsyncStorage.setItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, 'not-a-number');
    await expect(getSendThreshold()).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
  });

  it('rejects setting a non-positive threshold', async () => {
    await expect(setSendThreshold(0)).rejects.toThrow();
    await expect(setSendThreshold(-100)).rejects.toThrow();
  });

  it('rejects fractional thresholds that floor to 0', async () => {
    // Pre-fix bug: floored to 0, then validated against pre-floor value (0.5 > 0) and silently stored 0.
    await expect(setSendThreshold(0.5)).rejects.toThrow();
  });

  it('floors fractional thresholds that floor to a positive integer', async () => {
    await setSendThreshold(10500.7);
    await expect(getSendThreshold()).resolves.toBe(10500);
  });
});

describe('initialiseSendThresholdForNewInstall', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('leaves the key unset for a fresh install (no wallet_list, no onboarding_complete)', async () => {
    await initialiseSendThresholdForNewInstall();
    await expect(AsyncStorage.getItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY)).resolves.toBeNull();
    // Subsequent getSendThreshold returns the 10k default.
    await expect(getSendThreshold()).resolves.toBe(DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
  });

  it('writes the Off sentinel for an upgraded install with wallet_list populated', async () => {
    await AsyncStorage.setItem('wallet_list', JSON.stringify([{ id: 'a' }]));
    await initialiseSendThresholdForNewInstall();
    await expect(getSendThreshold()).resolves.toBeNull();
  });

  it('writes the Off sentinel when only onboarding_complete is set', async () => {
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await initialiseSendThresholdForNewInstall();
    await expect(getSendThreshold()).resolves.toBeNull();
  });

  it('treats an empty wallet_list ("[]") as fresh install', async () => {
    await AsyncStorage.setItem('wallet_list', '[]');
    await initialiseSendThresholdForNewInstall();
    await expect(AsyncStorage.getItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY)).resolves.toBeNull();
  });

  it('is idempotent — does not overwrite an existing user choice', async () => {
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await setSendThreshold(50_000); // explicit user choice
    await initialiseSendThresholdForNewInstall();
    await expect(getSendThreshold()).resolves.toBe(50_000);
  });
});
