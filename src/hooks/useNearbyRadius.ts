import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_RADIUS_METRES,
  loadNearbyRadius,
  saveNearbyRadius,
} from '../services/nearbyRadiusService';

/**
 * Shared hook for the "Show items within X km" preference. Hydrates
 * from AsyncStorage on mount, exposes a setter that also persists.
 * Used by ExploreHomeScreen, PlacesScreen, and HuntScreen so the
 * three views stay in sync without each one re-implementing chip
 * state.
 */
export const useNearbyRadius = (): {
  radius: number | null;
  setRadius: (next: number | null) => void;
  hydrated: boolean;
} => {
  const [radius, setRadiusState] = useState<number | null>(DEFAULT_RADIUS_METRES);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await loadNearbyRadius();
      if (cancelled) return;
      setRadiusState(r);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRadius = useCallback((next: number | null) => {
    setRadiusState(next);
    saveNearbyRadius(next);
  }, []);

  return { radius, setRadius, hydrated };
};
