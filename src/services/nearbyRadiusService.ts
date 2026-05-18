import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * User-preferred "nearby" radius used to filter the Explore hub rails,
 * the Places list and the Geo-caches list. One setting, cached in
 * AsyncStorage, applied everywhere so the user only configures it once.
 *
 * `null` means "show everything regardless of distance" — chip label
 * "All". Stored in metres so the UI can present any unit.
 */
const STORAGE_KEY = '@lp:nearby-radius-v1';

// Bumped from 50 km on user feedback — 50 km from a sparser area left
// rails like "Places near you" with only 1-2 BTC Map merchants visible.
// 100 km comfortably reaches a city centre from most suburbs/villages
// while still staying well under the fetcher's outer tier (500 km), so
// the merchant payload doesn't grow unexpectedly.
export const DEFAULT_RADIUS_METRES = 100_000; // 100 km

export interface RadiusOption {
  label: string;
  value: number | null; // metres; null = All
}

/**
 * Shared chip-row options. Sized for "walking → drive → road-trip"
 * brackets so most users pick a sensible default. "All" lifts the cap
 * entirely (useful when the area is sparse or when the user wants to
 * see what's published worldwide).
 */
export const RADIUS_OPTIONS: ReadonlyArray<RadiusOption> = [
  { label: '5 km', value: 5_000 },
  { label: '25 km', value: 25_000 },
  { label: '50 km', value: 50_000 },
  { label: '100 km', value: 100_000 },
  { label: '150 km', value: 150_000 },
  { label: 'All', value: null },
];

export const loadNearbyRadius = async (): Promise<number | null> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_RADIUS_METRES;
    if (raw === 'null') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_METRES;
  } catch {
    return DEFAULT_RADIUS_METRES;
  }
};

export const saveNearbyRadius = async (radiusMetres: number | null): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, radiusMetres === null ? 'null' : String(radiusMetres));
  } catch {
    // Best-effort persist — the in-memory state is still authoritative
    // for the current session.
  }
};
