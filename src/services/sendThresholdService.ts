/**
 * High-value send confirmation threshold (issue #82).
 *
 * Outgoing payments / wallet-to-wallet transfers at or above this many sats
 * trigger an explicit "are you sure?" confirmation dialog before being
 * dispatched. Below the threshold, sends stay snappy / one-tap.
 *
 * Configurable via Account → Security (`SecurityScreen`): Off / 1k / 10k /
 * 100k / Custom. The default 10,000-sat threshold applies to **new installs
 * only** — `initialiseSendThresholdForNewInstall` runs once on cold-start
 * and writes the "Off" sentinel for existing installs (anything with an
 * already-populated `wallet_list` or `onboarding_complete` flag), so
 * upgraders keep their previous one-tap behaviour and have to opt in to
 * confirmations from the Security screen.
 *
 * Acceptance bullet from the issue:
 *   "Default threshold applied for new users only."
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Default threshold in sats (~£5 at typical prices). Issue #82. */
export const DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS = 10_000;

/** AsyncStorage key the Account → Security settings UI reads/writes. */
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
export async function setSendThreshold(thresholdSats: number | null): Promise<void> {
  if (thresholdSats === null) {
    await AsyncStorage.setItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, OFF_SENTINEL);
    return;
  }
  // Floor first, then validate the floored integer — rejects fractional
  // inputs like 0.5 (which floored to 0 would land us in the silent-fallback
  // branch) and non-finite values consistently.
  const floored = Math.floor(thresholdSats);
  if (!Number.isFinite(floored) || floored < 1) {
    throw new Error(`Invalid send threshold: ${thresholdSats}`);
  }
  await AsyncStorage.setItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, String(floored));
}

/**
 * One-time-on-cold-start initialisation: distinguish a fresh install from
 * an upgrade so the 10k default only applies to new users.
 *
 * - **Fresh install** (no `wallet_list` and no `onboarding_complete`):
 *   leave the storage key unset → `getSendThreshold` returns the 10k
 *   default.
 * - **Upgrade** (either of those keys is present): write the "Off"
 *   sentinel so the previously-frictionless behaviour is preserved.
 *   Existing users opt into confirmations from Account → Security.
 *
 * Idempotent: short-circuits once the storage key is populated (with
 * either a number or the OFF sentinel). Safe to call on every cold
 * start; intended to run after `migrateLegacy()` so the install-state
 * signals are stable.
 */
export async function initialiseSendThresholdForNewInstall(): Promise<void> {
  const existing = await AsyncStorage.getItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY);
  if (existing !== null) return; // Already initialised — nothing to do.
  const walletList = await AsyncStorage.getItem('wallet_list');
  const onboarded = await AsyncStorage.getItem('onboarding_complete');
  const isUpgrade = (walletList && walletList !== '[]') || onboarded === 'true';
  if (isUpgrade) {
    await AsyncStorage.setItem(HIGH_VALUE_SEND_THRESHOLD_STORAGE_KEY, OFF_SENTINEL);
  }
  // Fresh install path: leave key unset; getSendThreshold returns the default.
}
