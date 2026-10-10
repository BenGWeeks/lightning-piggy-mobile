/**
 * High-value send confirmation threshold (issue #82).
 *
 * Outgoing payments / wallet-to-wallet transfers at or above this many sats
 * trigger an explicit "are you sure?" confirmation dialog before being
 * dispatched. Below the threshold, sends stay snappy / one-tap.
 *
 * Configurable via Account → Security (`SecurityScreen`): Off / 1k / 10k /
 * 100k / Custom, **per account**. Every new account starts at the default
 * 10,000-sat threshold; accounts that existed before the per-account change
 * inherit the old device-wide value (see `safetySettingsMigration`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import { ensureSafetySettingsMigrated, SEND_THRESHOLD_KEY_BASE } from './safetySettingsMigration';

/** Default threshold in sats (~£5 at typical prices). Issue #82. */
export const DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS = 10_000;

/**
 * Base AsyncStorage key; the threshold is stored PER ACCOUNT
 * (`perAccountKey(base, pubkey)`) because several family members share one
 * phone and one person's choice must not apply to the others.
 */
export const HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY = SEND_THRESHOLD_KEY_BASE;

/**
 * Sentinel string written when the user explicitly disables the
 * confirmation step ("Off" preset in the settings screen).
 */
const OFF_SENTINEL = 'off';

/**
 * Pure decision function — given an amount and a threshold, should we
 * prompt the user before dispatching? Extracted from the sheet code so it
 * can be unit-tested without mounting any React UI.
 *
 * - threshold === null → confirmation disabled by user, never prompt.
 * - amount >= threshold → prompt.
 * - amount <  threshold → no prompt.
 */
export function shouldConfirmSend(amountSats: number, thresholdSats: number | null): boolean {
  if (thresholdSats === null) return false;
  if (!Number.isFinite(amountSats) || amountSats <= 0) return false;
  if (!Number.isFinite(thresholdSats) || thresholdSats <= 0) return false;
  return amountSats >= thresholdSats;
}

/**
 * Read the current threshold from storage, returning the default for
 * unwritten keys (new installs).
 *
 * Returns `null` when the user has explicitly set "Off".
 */
export async function getSendThreshold(pubkey: string | null): Promise<number | null> {
  // No active account yet: confirm at the default rather than skip the check.
  if (!pubkey) return DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS;
  try {
    await ensureSafetySettingsMigrated(pubkey);
    const raw = await AsyncStorage.getItem(
      perAccountKey(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, pubkey),
    );
    if (raw === null) return DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS;
    if (raw === OFF_SENTINEL) return null;
    // Strictly numeric — parseInt('10000oops', 10) is 10000, which would silently honour a corrupt stored value instead of falling back to the default.
    if (!/^\d+$/.test(raw)) return DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS;
    }
    return parsed;
  } catch {
    // Storage read failures are non-fatal — fall back to the default so
    // we still confirm large sends rather than silently dispatching them.
    return DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS;
  }
}

/**
 * Persist the user's chosen threshold. Pass `null` to disable confirmations.
 * Used by the Account → Security settings screen (`SecurityScreen`).
 */
export async function setSendThreshold(
  thresholdSats: number | null,
  pubkey: string | null,
): Promise<void> {
  if (!pubkey) throw new Error('Cannot save the send threshold without an active account');
  await ensureSafetySettingsMigrated(pubkey);
  const key = perAccountKey(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, pubkey);
  if (thresholdSats === null) {
    await AsyncStorage.setItem(key, OFF_SENTINEL);
    return;
  }
  // Floor first, then validate the floored integer — rejects fractional
  // inputs like 0.5 (which floored to 0 would land us in the silent-fallback
  // branch) and non-finite values consistently.
  const floored = Math.floor(thresholdSats);
  if (!Number.isFinite(floored) || floored < 1) {
    throw new Error(`Invalid send threshold: ${thresholdSats}`);
  }
  await AsyncStorage.setItem(key, String(floored));
}
