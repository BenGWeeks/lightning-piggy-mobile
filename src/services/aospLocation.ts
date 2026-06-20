import * as Location from 'expo-location';

/**
 * GrapheneOS / de-Googled / bare-AOSP-safe location helpers.
 *
 * ## The bug this fixes
 *
 * On a device WITHOUT Google Play Services (GrapheneOS, /e/OS, and the
 * stock AOSP emulator image), one-shot location requests failed with:
 *
 *   "Location request failed due to unsatisfied device settings"
 *
 * That string is expo-location's `LocationSettingsUnsatisfiedException`,
 * raised from a Play-Services-only code path. Walking it through the
 * native module (`expo-location/android/.../LocationModule.kt`):
 *
 *   - `getCurrentPositionAsync` → `getCurrentLocationImplementation`.
 *   - If the **NETWORK_PROVIDER is disabled** AND `mayShowUserSettingsDialog`
 *     is true (its default), it does NOT request a fix directly. Instead it
 *     calls `resolveUserSettingsForRequest`, which uses
 *     `LocationServices.getSettingsClient(ctx).checkLocationSettings(...)`
 *     — the Google Play `SettingsClient`. On a device with no Play Services
 *     that task fails (not `RESOLUTION_REQUIRED`), so the module rejects
 *     with `LocationSettingsUnsatisfiedException`.
 *   - On a stock AOSP emulator the NETWORK_PROVIDER is typically off (GPS
 *     only, fed by `adb emu geo fix`), so this path is hit every time and
 *     location never resolves.
 *
 * ## The fix
 *
 * Pass `mayShowUserSettingsDialog: false`. With that flag the native
 * module skips the `SettingsClient` branch entirely and goes straight to
 * `requestSingleLocation`, which requests the fix from the provider
 * directly. `Accuracy.High` maps to `PRIORITY_HIGH_ACCURACY`, which uses
 * the GPS provider — exactly what `adb emu geo fix` feeds and what a
 * de-Googled device still has via the AOSP `LocationManager`. We lose the
 * "turn on high-accuracy mode" system dialog, but that dialog is a Play
 * Services surface that does not exist on GrapheneOS anyway, so there is
 * nothing to lose there.
 *
 * `watchPositionAsync` never used the `SettingsClient` path (it calls
 * `requestLocationUpdates` directly), so live watchers were already fine
 * — only the one-shot `getCurrentPositionAsync` callers were affected.
 * We still expose the default accuracy here so every call site shares one
 * accuracy / no-Play-dialog policy.
 */

/**
 * Default accuracy for both one-shot fixes and watchers. `High` maps to
 * Android's `PRIORITY_HIGH_ACCURACY`, which prefers the raw GPS provider
 * over Google's network-assisted fused location — the right choice on
 * de-Googled hardware and on emulators fed by `adb emu geo fix`.
 */
export const DEFAULT_LOCATION_ACCURACY: Location.LocationAccuracy = Location.Accuracy.High;

/**
 * Options for a single GPS fix that never touches the Play-Services
 * `SettingsClient`. Spread this into `getCurrentPositionAsync`.
 */
export function oneShotPositionOptions(
  accuracy: Location.LocationAccuracy = DEFAULT_LOCATION_ACCURACY,
): Location.LocationOptions {
  return {
    accuracy,
    // The load-bearing flag — see the module doc-comment. Without it,
    // de-Googled devices hit the Play `SettingsClient.checkLocationSettings`
    // path and reject with "unsatisfied device settings".
    mayShowUserSettingsDialog: false,
  };
}

/**
 * Request a single GPS fix in a way that works with OR without Google
 * Play Services. Thin wrapper over `getCurrentPositionAsync` that always
 * passes the GrapheneOS-safe options — use this instead of calling
 * `getCurrentPositionAsync` directly so the no-Play-dialog policy can't
 * be forgotten at a call site.
 */
export function getOneShotPosition(
  accuracy: Location.LocationAccuracy = DEFAULT_LOCATION_ACCURACY,
): Promise<Location.LocationObject> {
  return Location.getCurrentPositionAsync(oneShotPositionOptions(accuracy));
}
