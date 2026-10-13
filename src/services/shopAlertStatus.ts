import { loadNearbySettings } from './nearbySettingsService';
import { isGeofencingActive } from './geofenceService';

/** A saved preference alone does not prove that the OS geofence task is running. */
export async function loadShopAlertStatus(): Promise<boolean> {
  const [settings, active] = await Promise.all([loadNearbySettings(), isGeofencingActive()]);
  return settings.enabled && active;
}
