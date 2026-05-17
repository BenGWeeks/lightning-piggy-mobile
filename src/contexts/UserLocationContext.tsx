import React, { createContext, useContext } from 'react';
import {
  useLiveUserLocation,
  type LiveUserLocation,
  type UseLiveUserLocationOptions,
} from '../hooks/useLiveUserLocation';

/**
 * App-wide shared user-location subscription.
 *
 * Without this, every map surface (Explore hub, MapScreen, PlacesScreen,
 * EventDetailScreen, PlaceDetailScreen, HuntScreen, HuntCreateScreen)
 * called `useLiveUserLocation` directly. Each call spun up its own
 * `watchPositionAsync` subscription, so a session that touches three
 * maps fan-outs to three concurrent GPS subscriptions — wasteful
 * battery + risk of slightly-divergent positions on neighbouring
 * screens (different mount times → different last-fix moments).
 *
 * Wrap the app in `<UserLocationProvider>` once and have every map
 * consume via `useUserLocation()`. One subscription, one position,
 * every screen sees the same dot in the same place.
 *
 * Mounted high in the tree (App.tsx) so the subscription survives
 * tab switches — re-using a warm position is also a perceived-perf
 * win on cold opens of a map screen.
 */
const UserLocationContext = createContext<{
  pos: LiveUserLocation | null;
  denied: boolean;
} | null>(null);

export const UserLocationProvider: React.FC<
  { children: React.ReactNode } & UseLiveUserLocationOptions
> = ({ children, ...opts }) => {
  const value = useLiveUserLocation(opts);
  return <UserLocationContext.Provider value={value}>{children}</UserLocationContext.Provider>;
};

/**
 * Hook-style accessor. Throws if used outside the provider so a screen
 * never silently falls through to a null `pos` because someone forgot
 * to wrap. Match the same calling shape as the bare hook so the screen
 * code paths are a one-line swap.
 */
export const useUserLocation = (): {
  pos: LiveUserLocation | null;
  denied: boolean;
} => {
  const value = useContext(UserLocationContext);
  if (value === null) {
    throw new Error('useUserLocation must be used inside <UserLocationProvider>');
  }
  return value;
};
