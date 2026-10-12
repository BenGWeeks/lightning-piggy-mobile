// Side-effect module (imported from index.ts): defines the live-location
// TaskManager task in the global scope, so the OS can deliver background
// location batches even after a relaunch with no React tree mounted (#1300).
// The logic lives in liveLocationTracker.ts.

// FIRST: index.ts loads this module before App.tsx installs the polyfills, and
// the tracker pulls in the Nostr / Marmot crypto stack, which captures
// `crypto.getRandomValues` at import time (else Marmot sends fail with
// "crypto.getRandomValues must be defined").
import '../polyfills';
import type * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import {
  handleTaskLocations,
  hasLiveLocationFixHandler,
  LIVE_LOCATION_TASK,
  stopSharingHeadless,
} from './liveLocationTracker';
import { isLiveShareStopResponse, LIVE_LOCATION_STOP_TASK } from './liveLocationNotification';

if (!TaskManager.isTaskDefined(LIVE_LOCATION_TASK)) {
  TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
    await handleTaskLocations(locations).catch(() => undefined);
  });
}

// "Stop sharing" pressed when the app process had to be started for it (or
// with no provider mounted): the notification task registered while the
// share's notification is up.
if (!TaskManager.isTaskDefined(LIVE_LOCATION_STOP_TASK)) {
  TaskManager.defineTask(LIVE_LOCATION_STOP_TASK, async ({ data }) => {
    if (isLiveShareStopResponse(data) && !hasLiveLocationFixHandler()) {
      await stopSharingHeadless().catch(() => undefined);
    }
  });
}

// "Stop sharing" on the notification while no provider is mounted (the share
// kept running after the UI was destroyed). A mounted provider handles it
// itself — it can send the end markers straight away.
Notifications.addNotificationResponseReceivedListener((response) => {
  if (isLiveShareStopResponse(response) && !hasLiveLocationFixHandler()) {
    void stopSharingHeadless().catch(() => undefined);
  }
});
