/**
 * GPS side of live-location sharing (#1300): WhatsApp-style updates that keep
 * flowing while the app is minimised or the phone is locked.
 *
 *   - Background mode: `startLocationUpdatesAsync` + the TaskManager task in
 *     `liveLocationTask.ts`. Android runs it in a location foreground service
 *     (persistent notification); iOS needs `UIBackgroundModes: location` and
 *     shows the blue location pill. Both need only the "While in use"
 *     permission the share already asked for — no "Always" prompt.
 *   - Foreground fallback: when background updates can't start (an iOS build
 *     without the background mode, or Android refusing the service), the old
 *     `watchPositionAsync` path — the provider then pauses on background.
 *
 * Fixes go to the mounted LiveLocationProvider (the normal case: the process
 * and JS runtime stay alive in the background). If the OS runs the task with
 * no provider mounted (the UI was destroyed, or a headless relaunch), the
 * headless path sends updates itself from the persisted sessions — NIP-17 via
 * the session key, Marmot only if a Marmot session is already running — and
 * stops tracking once nothing is left to share. One dispatcher serves both,
 * so the cadence carries over between them.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { expiryFor } from './liveLocationService';
import {
  createLiveUpdateDispatcher,
  LIVE_UPDATE_MIN_INTERVAL_MS,
  type TrackedFix,
} from './liveLocationPolicy';
import { loadPersistedSessions } from './liveLocationStorage';
import { sendLiveUpdate } from './liveLocationSender';
import { dismissLiveShareNotification } from './liveLocationNotification';
import type { OutgoingSession } from './liveLocationStateMachine';
import { t } from '../i18n';

export const LIVE_LOCATION_TASK = 'lp-live-location';
const TRACKING_KEY = 'live_location_tracking_v1';

export type TrackingMode = 'background' | 'foreground';

/** Shared by the provider and the headless path (see header). */
export const liveUpdateDispatcher = createLiveUpdateDispatcher();

type FixHandler = (fix: TrackedFix) => void;
let handler: FixHandler | null = null;
let watcher: Location.LocationSubscription | null = null;
let mode: TrackingMode | null = null;

/** The provider registers while mounted; null when it unmounts. */
export function setLiveLocationFixHandler(next: FixHandler | null): void {
  handler = next;
}

export const getTrackingMode = (): TrackingMode | null => mode;

function toFix(loc: Location.LocationObject): TrackedFix {
  const { latitude, longitude, accuracy, heading } = loc.coords;
  return {
    location: {
      lat: latitude,
      lon: longitude,
      accuracyMeters:
        typeof accuracy === 'number' && isFinite(accuracy) ? Math.round(accuracy) : null,
    },
    heading:
      typeof heading === 'number' && isFinite(heading) && heading >= 0 ? Math.round(heading) : null,
    ts: typeof loc.timestamp === 'number' && isFinite(loc.timestamp) ? loc.timestamp : Date.now(),
  };
}

/** The newest fix in a task batch (the OS may deliver several at once). */
export function newestFix(locations: Location.LocationObject[] | undefined): TrackedFix | null {
  let best: Location.LocationObject | null = null;
  for (const l of locations ?? []) {
    if (!l?.coords) continue;
    if (!best || (l.timestamp ?? 0) > (best.timestamp ?? 0)) best = l;
  }
  return best ? toFix(best) : null;
}

interface TrackingContext {
  owner: string;
  relays: string[];
}

async function loadTrackingContext(): Promise<TrackingContext | null> {
  try {
    const raw = await AsyncStorage.getItem(TRACKING_KEY);
    const c = raw ? (JSON.parse(raw) as Partial<TrackingContext>) : null;
    return c && typeof c.owner === 'string' && Array.isArray(c.relays)
      ? { owner: c.owner, relays: c.relays.filter((r): r is string => typeof r === 'string') }
      : null;
  } catch {
    return null;
  }
}

/** Sessions the headless path may still send for (pure — unit-tested). */
export function headlessLiveSessions(persisted: OutgoingSession[], now: number): OutgoingSession[] {
  return persisted
    .filter(
      (s) =>
        !s.stopRequested &&
        s.startMarkerSent &&
        !s.endMarkerSent &&
        now < expiryFor(s.startedAt, s.durationMs),
    )
    .map((s) => ({ ...s, status: 'active' as const }));
}

async function runHeadless(fix: TrackedFix): Promise<void> {
  const ctx = await loadTrackingContext();
  const live = ctx ? headlessLiveSessions(await loadPersistedSessions(ctx.owner), Date.now()) : [];
  if (!ctx || live.length === 0) {
    // Nothing left to share: stop the service. The end markers go out from
    // the provider's drain loop on the next app open.
    await stopTracking();
    await dismissLiveShareNotification();
    return;
  }
  await liveUpdateDispatcher.handleFix(fix, live, (s, p) =>
    sendLiveUpdate(ctx.owner, s, p, ctx.relays),
  );
}

/** Entry point for the TaskManager task (see liveLocationTask.ts). */
export async function handleTaskLocations(locations: Location.LocationObject[] | undefined) {
  const fix = newestFix(locations);
  if (!fix) return;
  if (handler) handler(fix);
  else await runHeadless(fix);
}

/**
 * Start delivering fixes (idempotent). Prefers background updates; falls
 * back to a foreground-only watcher. Resolves with the mode in use.
 */
export async function startTracking(ctx: TrackingContext): Promise<TrackingMode> {
  await AsyncStorage.setItem(TRACKING_KEY, JSON.stringify(ctx)).catch(() => undefined);
  if (mode === 'background') return mode;
  try {
    await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      // Android: one fix per update window, even when still (heartbeat).
      timeInterval: LIVE_UPDATE_MIN_INTERVAL_MS,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: t('liveLocationTracking.serviceTitle'),
        notificationBody: t('liveLocationTracking.serviceBody'),
        notificationColor: '#e91e63',
        // Keep sharing if the app is swiped away (the headless path takes over).
        killServiceOnDestroy: false,
      },
    });
    watcher?.remove();
    watcher = null;
    mode = 'background';
  } catch (e) {
    if (__DEV__) console.warn('[LiveLocation] background updates unavailable, foreground only:', e);
    if (!watcher) {
      watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LIVE_UPDATE_MIN_INTERVAL_MS,
          distanceInterval: 0,
        },
        (pos) => handler?.(toFix(pos)),
      );
    }
    mode = 'foreground';
  }
  return mode;
}

/** Stop every fix source and forget the tracking context. */
export async function stopTracking(): Promise<void> {
  watcher?.remove();
  watcher = null;
  mode = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
    }
  } catch {
    // Task never registered on this run — nothing to stop.
  }
  await AsyncStorage.removeItem(TRACKING_KEY).catch(() => undefined);
}
