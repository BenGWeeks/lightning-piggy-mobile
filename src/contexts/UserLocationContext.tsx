import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
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
 * `useLiveUserLocation` hook only fires once at least one consumer
 * has called `useUserLocation()`. When the last consumer unmounts
 * the subscription tears down automatically.
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

/**
 * Inner component that subscribes via the hook only when activated.
 * Lives behind a conditional so when `active === false` no GPS calls
 * are made at all.
 */
const LiveSubscription: React.FC<
  UseLiveUserLocationOptions & {
    onChange: (v: UserLocationValue) => void;
  }
> = ({ onChange, ...opts }) => {
  const value = useLiveUserLocation(opts);
  // Hand the hook's current state up to the provider so it can be
  // distributed via context. We don't use the hook's return directly
  // because consumers are subscribed via the context's Provider —
  // this component's render output is intentionally null.
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
};

export const UserLocationProvider: React.FC<
  { children: React.ReactNode } & UseLiveUserLocationOptions
> = ({ children, ...opts }) => {
  // Ref count of active consumers. When > 0, mount the subscription.
  // When it drops back to 0, unmount it so GPS goes idle.
  const [refCount, setRefCount] = useState(0);
  const [value, setValue] = useState<UserLocationValue>({ pos: null, denied: false });
  // Stable retain/release identity so consumers' useEffect cleanup
  // doesn't see "different function" on every render and re-run.
  const retain = useRef(() => setRefCount((c) => c + 1)).current;
  const release = useRef(() => setRefCount((c) => Math.max(0, c - 1))).current;

  return (
    <UserLocationContext.Provider value={{ value, retain, release }}>
      {refCount > 0 ? <LiveSubscription {...opts} onChange={setValue} /> : null}
      {children}
    </UserLocationContext.Provider>
  );
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
  useEffect(() => {
    retain();
    return () => release();
  }, [retain, release]);
  return value;
};
