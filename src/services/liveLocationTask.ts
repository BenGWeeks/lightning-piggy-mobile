// Side-effect module (imported from index.ts): defines the live-location
// TaskManager task in the global scope, so the OS can deliver background
// location batches even after a relaunch with no React tree mounted (#1300).
// The logic lives in liveLocationTracker.ts.

import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { handleTaskLocations, LIVE_LOCATION_TASK } from './liveLocationTracker';

if (!TaskManager.isTaskDefined(LIVE_LOCATION_TASK)) {
  TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
    await handleTaskLocations(locations).catch(() => undefined);
  });
}
