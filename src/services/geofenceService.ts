import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { getOneShotPosition } from './aospLocation';
import { acceptsLightning, fetchPlacesInBbox, type Bbox, type BtcMapPlace } from './btcMapService';
import { isWithinQuietHours, loadNearbySettings } from './nearbySettingsService';
import { haversineMetres } from '../utils/geohash';

/**
 * Background geofence service for the "Nearby Bitcoin merchants" feature
 * (#467). Wraps `expo-location`'s native geofencing API:
 *   1. Caller invokes `enableGeofencing()` from the settings UI after the
 *      user has granted background-location + notification permissions.
 *   2. We fetch a city-block window of merchants from BTC Map and
 *      register up to 20 geofences (the OS-imposed cap on both Android
 *      and iOS).
 *   3. The OS fires `GEOFENCE_TASK` on a region transition; the task
 *      consults the user's nearby-settings (radius, quiet hours) and
 *      posts a local notification.
 *
 * Recompute logic — when the user moves more than `RECOMPUTE_DISTANCE_M`
 * from the centre of the last fetch, the caller should run
 * `enableGeofencing()` again so a fresh region set is registered. We
 * don't auto-rerun from the background task itself; that path lives in
 * a foreground "active map" subscription and is out of scope for v1.
 */

export const GEOFENCE_TASK = 'lp-merchant-geofence';
const NEARBY_LIMIT = 20;
const FETCH_HALF_DEGREES = 0.02; // ≈ 2 km city block
export const RECOMPUTE_DISTANCE_M = 500;

interface GeofenceTaskEvent {
  eventType?: Location.GeofencingEventType;
  region?: Location.LocationRegion & { identifier?: string };
}

// Module-level cache so the background task can resolve a region.identifier
// (BTC Map place id) back to a human label + payment-method flag without
// an extra network call. The Lightning flag drives notification copy so
// we never claim a place "accepts Lightning" when `pickNearest` fell
// back to on-chain-only merchants (Copilot review #488).
interface PlaceMeta {
  name: string;
  lightning: boolean;
}
const placeMeta = new Map<string, PlaceMeta>();

/**
 * Register the background task. Idempotent — calling more than once
 * is safe; TaskManager dedupes by name.
 */
const ensureTaskDefined = (): void => {
  if (TaskManager.isTaskDefined(GEOFENCE_TASK)) return;
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[geofence] task error', error);
      return;
    }
    const event = (data ?? {}) as GeofenceTaskEvent;
    if (event.eventType !== Location.GeofencingEventType.Enter) return;

    const settings = await loadNearbySettings();
    if (!settings.enabled) return;
    if (settings.quietHoursEnabled && isWithinQuietHours()) return;

    const id = event.region?.identifier ?? '';
    // Fallback to neutral on-chain copy when the placeMeta cache is
    // empty (JS context restart between fence registration and
    // trigger, or an unknown region.identifier). Defaulting to
    // Lightning would risk claiming a non-Lightning merchant accepts
    // it — neutral is safer than wrong (Copilot review #488).
    const meta = placeMeta.get(id) ?? { name: 'a Bitcoin shop', lightning: false };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: meta.lightning ? '⚡ Lightning accepted nearby' : '₿ Bitcoin accepted nearby',
        body: meta.lightning
          ? `${meta.name} accepts Lightning. Open Lightning Piggy to pay.`
          : `${meta.name} accepts Bitcoin (on-chain). Open Lightning Piggy for details.`,
        data: { kind: 'merchant-geofence', placeId: id },
      },
      trigger: null,
    });
  });
};

/**
 * Active-state predicate consumed by settings UI to decide whether to
 * show "Geofencing on" vs "Geofencing off" copy without us having to
 * reach into TaskManager state from the screen layer.
 */
export const isGeofencingActive = async (): Promise<boolean> => {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
};

/**
 * Start (or refresh) merchant geofencing. Caller is responsible for
 * holding the relevant permissions (we call `requestPermissions...` in
 * the UI layer so the user sees the OS prompt at the moment they tap
 * the toggle, not during a re-init).
 *
 * Returns the number of registered regions, or null if no merchants
 * could be found near the user.
 */
export const enableGeofencing = async (): Promise<number | null> => {
  ensureTaskDefined();

  // getOneShotPosition passes `mayShowUserSettingsDialog: false` so this
  // works on de-Googled / no-Play-Services devices — see aospLocation.ts.
  const pos = await getOneShotPosition();
  const bbox: Bbox = {
    minLon: pos.coords.longitude - FETCH_HALF_DEGREES,
    minLat: pos.coords.latitude - FETCH_HALF_DEGREES,
    maxLon: pos.coords.longitude + FETCH_HALF_DEGREES,
    maxLat: pos.coords.latitude + FETCH_HALF_DEGREES,
  };

  const places = await fetchPlacesInBbox(bbox);
  if (places.length === 0) return null;

  const settings = await loadNearbySettings();
  // pickNearest prefers Lightning-accepting merchants; if the area has only
  // on-chain ones we fall back to those rather than registering an empty
  // regions array (Copilot review #488). startGeofencingAsync throws on []
  // on iOS and silently no-ops on Android, neither of which we want.
  const top = pickNearest(places, pos.coords.latitude, pos.coords.longitude, NEARBY_LIMIT);
  if (top.length === 0) return null;

  // Cache id → {name, lightning} for the background task. Map is module-
  // level so it survives JS-context restarts within the same process.
  // The lightning flag lets the notification copy match the actual
  // payment type — necessary because `pickNearest` falls back to
  // on-chain-only merchants when no Lightning ones are nearby.
  placeMeta.clear();
  for (const place of top) {
    placeMeta.set(String(place.id), {
      name: labelOf(place),
      lightning: acceptsLightning(place),
    });
  }

  const regions: Location.LocationRegion[] = top.map((place) => ({
    identifier: String(place.id),
    latitude: place.lat,
    longitude: place.lon,
    radius: settings.alertRadiusMeters,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));

  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);

  return regions.length;
};

/**
 * Stop the geofence task and clear the cached label map. Safe to call
 * whether or not the task was running.
 */
export const disableGeofencing = async (): Promise<void> => {
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
  placeMeta.clear();
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const pickNearest = (
  places: BtcMapPlace[],
  lat: number,
  lng: number,
  limit: number,
): BtcMapPlace[] => {
  // Prefer Lightning-friendly merchants (Hunt's #467 spec leans toward
  // ⚡-capable shops), but fall back to all-Bitcoin if the user's area
  // has none — better to alert on an on-chain shop than nothing
  // (Copilot review #488). Distance-sort either way. Reuses
  // `haversineMetres` from `utils/geohash` rather than re-implementing
  // the formula (Copilot review #488 round 2).
  const here = { lat, lon: lng };
  const lightning = places
    .filter(acceptsLightning)
    .map((p) => ({ p, d: haversineMetres(here, { lat: p.lat, lon: p.lon }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
  if (lightning.length > 0) return lightning.map(({ p }) => p);
  return places
    .map((p) => ({ p, d: haversineMetres(here, { lat: p.lat, lon: p.lon }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ p }) => p);
};

const labelOf = (p: BtcMapPlace): string => p.tags.name ?? 'A Bitcoin merchant';
