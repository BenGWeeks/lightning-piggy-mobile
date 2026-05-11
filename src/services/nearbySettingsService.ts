import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persisted user preferences for the "Nearby Bitcoin merchants" alerts
 * feature (#467). Stored under a single AsyncStorage key (no per-account
 * scoping — geofences are device-level by nature).
 */
export interface NearbySettings {
  /** Master switch. Default OFF — opt-in, since the feature requires
   * background-location permission. */
  enabled: boolean;
  /** Distance from the user a merchant has to be inside before we fire.
   * Stored in metres so the UI can present any unit. */
  alertRadiusMeters: 50 | 100 | 250 | 500;
  /** Suppress alerts during the user-defined window. We model only the
   * "all-or-nothing" preset for v1 (22:00–08:00 local time) — adding a
   * custom picker is out of scope for this PR. */
  quietHoursEnabled: boolean;
}

const STORAGE_KEY = 'nearby-settings:v1';

export const DEFAULT_NEARBY_SETTINGS: NearbySettings = {
  enabled: false,
  alertRadiusMeters: 100,
  quietHoursEnabled: false,
};

/**
 * Read the current settings, returning defaults if nothing is stored or
 * the stored payload is corrupt. We never throw from this path — UI
 * needs deterministic state on first render.
 */
export const loadNearbySettings = async (): Promise<NearbySettings> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NEARBY_SETTINGS;
    const parsed = JSON.parse(raw);
    // Strict per-field type validation. A corrupted-but-JSON payload
    // like `{ "enabled": "yes" }` would otherwise pass the
    // nullish-coalesce as a truthy non-boolean and flip the geofence
    // logic. Per Copilot review on PR #488.
    return {
      enabled:
        typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_NEARBY_SETTINGS.enabled,
      alertRadiusMeters: isAllowedRadius(parsed?.alertRadiusMeters)
        ? parsed.alertRadiusMeters
        : DEFAULT_NEARBY_SETTINGS.alertRadiusMeters,
      quietHoursEnabled:
        typeof parsed?.quietHoursEnabled === 'boolean'
          ? parsed.quietHoursEnabled
          : DEFAULT_NEARBY_SETTINGS.quietHoursEnabled,
    };
  } catch {
    return DEFAULT_NEARBY_SETTINGS;
  }
};

export const saveNearbySettings = async (next: NearbySettings): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
};

const ALLOWED_RADII: NearbySettings['alertRadiusMeters'][] = [50, 100, 250, 500];
const isAllowedRadius = (v: unknown): v is NearbySettings['alertRadiusMeters'] =>
  ALLOWED_RADII.includes(v as never);

/**
 * Quiet-hours predicate. Returns true if the given moment falls inside
 * the configured window. We hard-code 22:00–08:00 local time; bumping
 * to a custom-window UI is a future extension.
 */
export const isWithinQuietHours = (now: Date = new Date()): boolean => {
  const hour = now.getHours();
  return hour >= 22 || hour < 8;
};
