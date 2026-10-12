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
  transportFor,
  LIVE_UPDATE_MIN_INTERVAL_MS,
  type TrackedFix,
} from './liveLocationPolicy';
import { loadPersistedSessions, savePersistedSessions } from './liveLocationStorage';
import { sendLiveUpdate } from './liveLocationSender';
import { restoreMarmotSessionHeadless } from './marmotHeadlessSession';
import { dismissLiveShareNotification } from './liveLocationNotification';
import type { OutgoingSession } from './liveLocationStateMachine';
import { t } from '../i18n';

export const LIVE_LOCATION_TASK = 'lp-live-location';
const TRACKING_KEY = 'live_location_tracking_v1';

export type TrackingMode = 'background' | 'foreground';

/** Shared by the provider and the headless path (see header). */
export const liveUpdateDispatcher = createLiveUpdateDispatcher();

type FixHandler = (fix: TrackedFix) => Promise<unknown> | void;
let handler: FixHandler | null = null;
let watcher: Location.LocationSubscription | null = null;
let mode: TrackingMode | null = null;

/** The provider registers while mounted; null when it unmounts. */
export function setLiveLocationFixHandler(next: FixHandler | null): void {
  handler = next;
}

export const getTrackingMode = (): TrackingMode | null => mode;

/** True while a LiveLocationProvider is mounted to handle fixes and Stop. */
export const hasLiveLocationFixHandler = (): boolean => handler !== null;

/**
 * "Stop sharing" pressed with no provider mounted (the UI was destroyed while
 * the share ran on): stop tracking now and mark the owner's shares so the
 * provider sends their end markers on the next app open.
 */
export async function stopSharingHeadless(): Promise<void> {
  const ctx = await loadTrackingContext();
  if (ctx) {
    const persisted = await loadPersistedSessions(ctx.owner);
    await savePersistedSessions(
      ctx.owner,
      persisted.map((s) => ({ ...s, stopRequested: true })),
    );
  }
  await stopTracking();
  await dismissLiveShareNotification();
}

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
  const persisted = ctx ? await loadPersistedSessions(ctx.owner) : [];
  let live = ctx ? headlessLiveSessions(persisted, Date.now()) : [];
  if (ctx && live.some((s) => transportFor(s) === 'marmot')) {
    // Marmot updates need the MLS session: restore it (no UI is mounted).
    // If that's impossible (the account was switched away), end those shares
    // cleanly — the end marker goes out on the next app open — instead of
    // streaming into nowhere while the notification says we're sharing.
    if (!(await restoreMarmotSessionHeadless(ctx.owner, ctx.relays))) {
      const ended = new Set(
        live.filter((s) => transportFor(s) === 'marmot').map((s) => s.sessionId),
      );
      await savePersistedSessions(
        ctx.owner,
        persisted.map((s) => (ended.has(s.sessionId) ? { ...s, stopRequested: true } : s)),
      );
      live = live.filter((s) => !ended.has(s.sessionId));
    }
  }
  if (!ctx || live.length === 0) {
    // Nothing left to share: stop the service. The end markers go out from
    // the provider's drain loop on the next app open.
    await stopTracking();
    await dismissLiveShareNotification();
    return;
  }
  const owner = ctx.owner;
  await liveUpdateDispatcher.handleFix(fix, live, (s, p) =>
    sendLiveUpdate(owner, s, p, ctx.relays),
  );
}

/** Entry point for the TaskManager task (see liveLocationTask.ts). */
export async function handleTaskLocations(locations: Location.LocationObject[] | undefined) {
  const fix = newestFix(locations);
  if (!fix) return;
  // Await the sends: the OS may suspend us once the task's promise settles.
  if (handler) await handler(fix);
  else await runHeadless(fix);
}

/**
 * Start delivering fixes (idempotent). Prefers background updates; falls
 * back to a foreground-only watcher. Resolves with the mode in use.
 */
export function startTracking(ctx: TrackingContext): Promise<TrackingMode> {
  return serial(() => startTrackingNow(ctx));
}

// Native start / stop run one at a time, in call order: a Stop issued while a
// start is pending runs after it (and undoes it) instead of racing it.
let lifecycle: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = lifecycle.then(op, op);
  lifecycle = run.catch(() => undefined);
  return run;
}

async function startTrackingNow(ctx: TrackingContext): Promise<TrackingMode> {
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
export function stopTracking(): Promise<void> {
  return serial(stopTrackingNow);
}

async function stopTrackingNow(): Promise<void> {
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
