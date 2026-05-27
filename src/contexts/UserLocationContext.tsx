import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  useLiveUserLocation,
  type LiveUserLocation,
  type UseLiveUserLocationOptions,
} from '../hooks/useLiveUserLocation';

/**
 * App-wide shared user-location subscription with **lazy + ref-counted**
 * activation.
 *
 * Without this, every map surface (Explore hub, MapScreen, PlacesScreen,
 * EventDetailScreen, PlaceDetailScreen, HuntScreen, HuntCreateScreen)
 * called `useLiveUserLocation` directly. Each call spun up its own
 * `watchPositionAsync` subscription, so a session that touches three
 * maps fan-outed to three concurrent GPS subscriptions — wasteful
 * battery + risk of slightly-divergent positions on neighbouring
 * screens (different mount times → different last-fix moments).
 *
 * But mounting a permanent subscription at app root was also wrong: it
 * would have triggered the location permission prompt on every app
 * launch, and kept the GPS hot during Home / Messages / Friends flows
 * that never show a map. So the provider here is lazy: the underlying
 * `useLiveUserLocation` hook only fires its GPS calls once at least
 * one consumer has called `useUserLocation()`. When the last consumer
 * unmounts the subscription tears down automatically.
 *
 * The hook itself always runs in the provider (so the React tree
 * stays stable across enable/disable transitions) — it just no-ops
 * its GPS path when `enabled === false`.
 */
interface UserLocationValue {
  pos: LiveUserLocation | null;
  denied: boolean;
}

const UserLocationContext = createContext<{
  value: UserLocationValue;
  retain: () => void;
  release: () => void;
} | null>(null);

export const UserLocationProvider: React.FC<
  { children: React.ReactNode } & UseLiveUserLocationOptions
> = ({ children, ...opts }) => {
  // Ref count of active consumers. When > 0, enable the hook's GPS
  // path. When it drops back to 0, the hook tears its watch down.
  const [refCount, setRefCount] = useState(0);
  // Stable retain/release identity so consumers' useEffect cleanup
  // doesn't see "different function" on every render and re-run
  // (which would loop release/retain indefinitely).
  const retain = useRef(() => setRefCount((c) => c + 1)).current;
  const release = useRef(() => setRefCount((c) => Math.max(0, c - 1))).current;

  // Single hook call, with `enabled` flipping between gpu-cold and
  // gpu-hot. Tree-stable: no remount of children when refCount
  // transitions 0 ↔ 1.
  const live = useLiveUserLocation({ ...opts, enabled: refCount > 0 });

  // Stabilise the context object's identity by reference — without
  // this every parent render passes a fresh object as `value` to
  // every consumer's useContext, which would re-render every map
  // even when pos hasn't changed. Memo on the load-bearing fields.
  const ctxValue = useMemo(
    () => ({ value: { pos: live.pos, denied: live.denied }, retain, release }),
    [live.pos, live.denied, retain, release],
  );

  return <UserLocationContext.Provider value={ctxValue}>{children}</UserLocationContext.Provider>;
};

/**
 * Hook-style accessor. Throws if used outside the provider so a screen
 * never silently falls through to a null `pos` because someone forgot
 * to wrap. Returns the same shape as the bare `useLiveUserLocation`
 * hook so the screen code paths are a one-line swap.
 *
 * Calling this hook retains a reference on the underlying GPS
 * subscription for the lifetime of the consuming component, and
 * releases it on unmount. So the watch only runs while at least one
 * map screen is mounted.
 */
export const useUserLocation = (): UserLocationValue => {
  const ctx = useContext(UserLocationContext);
  if (ctx === null) {
    throw new Error('useUserLocation must be used inside <UserLocationProvider>');
  }
  const { value, retain, release } = ctx;
  // useEffect (mount/unmount), NOT useFocusEffect (#731 Fix 3).
  //
  // The bottom-tab navigator uses `freezeOnBlur: true`, which keeps map
  // screens (Explore, Friends) mounted even when their tab is hidden.
  // The previous `useFocusEffect` retain/release tore the GPS watch down
  // on every tab blur and restarted it on every tab focus — firing
  // `requestForegroundPermissionsAsync` 4× in a 7-tab-switch test and
  // adding ~100–200 ms of GPS re-init overhead to each Explore/Friends
  // focus (regression from #595/#597, confirmed in #731 audit).
  //
  // Mount-scoped retain keeps the watch alive across tab switches while
  // the consumer screen stays mounted (the common case under freezeOnBlur).
  // The watch tears down naturally on unmount (e.g. when the user hard-
  // navigates away from a map screen stack). The ref-count semantics in
  // UserLocationProvider are unchanged: refCount drops to 0 when the last
  // mounted consumer unmounts, and the watch tears down then.
  useEffect(() => {
    retain();
    return () => release();
  }, [retain, release]);
  return value;
};
