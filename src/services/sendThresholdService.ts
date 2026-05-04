/**
 * High-value send confirmation threshold (issue #82).
 *
 * Outgoing payments / wallet-to-wallet transfers at or above this many sats
 * trigger an explicit "are you sure?" confirmation dialog before being
 * dispatched. Below the threshold, sends stay snappy / one-tap.
 *
 * For this PR the threshold is a hardcoded default with an AsyncStorage
 * override hook — a full Account → Security UI to tune it (Off / 1k / 10k /
 * 100k / Custom) is tracked as a follow-up. The storage key + helpers are
 * shipped now so the future settings screen has a stable API to bind to.
 *
 * Acceptance bullet from the issue:
 *   "Default threshold applied for new users only."
 *
 * Honoured implicitly: existing installs that have never written the
 * storage key inherit the new default, but any explicit user choice
 * (including `null` for "Off") is preserved across upgrades.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Default threshold in sats (~£5 at typical prices). Issue #82. */
export const DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS = 10_000;

/** AsyncStorage key the future settings UI will read/write. */
export const HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY = 'send_threshold_sats_v1';

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
export async function getSendThreshold(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY);
    if (raw === null) return DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS;
    if (raw === OFF_SENTINEL) return null;
    const parsed = parseInt(raw, 10);
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
 * Used by the (future) Account → Security settings screen.
 */
export async function setSendThreshold(thresholdSats: number | null): Promise<void> {
  if (thresholdSats === null) {
    await AsyncStorage.setItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, OFF_SENTINEL);
    return;
  }
  if (!Number.isFinite(thresholdSats) || thresholdSats <= 0) {
    throw new Error(`Invalid send threshold: ${thresholdSats}`);
  }
  await AsyncStorage.setItem(
    HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY,
    String(Math.floor(thresholdSats)),
  );
}
