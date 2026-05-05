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
});
