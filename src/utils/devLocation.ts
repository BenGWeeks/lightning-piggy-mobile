/**
 * Dev-only emulator fallback for `Location.getCurrentPositionAsync`.
 *
 * Android Virtual Devices without Google Play Services (most "stock"
 * AVD images, including the ones the project's `eas.json` defaults to)
 * accept `adb emu geo fix lon lat` at the console but the GPS HAL
 * never writes the fix into any `LocationManager` provider's
 * last-known cache — see `docs/TROUBLESHOOTING.adoc` →
 * "Android emulator GPS / `geo fix` doesn't propagate to apps".
 *
 * Result: every screen that calls `Location.getCurrentPositionAsync`
 * hangs forever and `getLastKnownPositionAsync` returns null, so the
 * Explore hub, MapScreen, HuntDiscoverScreen, EventsScreen, and
 * NearbyScreen all sit in their "Locating you…" state for the entire
 * emulator session.
 *
 * This helper returns a pinned position from `.env`-supplied
 * `EXPO_PUBLIC_DEV_LAT` / `EXPO_PUBLIC_DEV_LON` whenever the bundle
 * is in `__DEV__` mode AND the env vars are present. Production
 * builds (`__DEV__ === false`) never enter this path; the env vars
 * are also gitignored. Callers should prefer this helper over the
 * real Location API only as a fast pre-flight — if it returns null
 * they should still proceed with the normal foreground-permission
 * + `getCurrentPositionAsync` flow.
 */
export const getDevPinnedLocation = (): { lat: number; lon: number } | null => {
  if (!__DEV__) return null;
  const latRaw = process.env.EXPO_PUBLIC_DEV_LAT;
  const lonRaw = process.env.EXPO_PUBLIC_DEV_LON;
  if (!latRaw || !lonRaw) return null;
  const lat = parseFloat(latRaw);
  const lon = parseFloat(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};
