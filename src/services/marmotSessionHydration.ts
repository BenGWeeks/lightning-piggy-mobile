import { perfLog } from '../utils/perfLog';

/** Persisted MLS state restore, before opening live group subscriptions. */
export async function hydrateMarmotSession<T>(
  loadWatermarks: () => Promise<void>,
  loadGroups: () => Promise<T[]>,
  wireGroup: (group: T) => void,
  replayHistory: (group: T) => Promise<void>,
): Promise<void> {
  perfLog('MLS/Marmot session hydration start');
  try {
    await loadWatermarks();
    const loaded = await loadGroups();
    loaded.forEach(wireGroup);
    for (const group of loaded) {
      await replayHistory(group).catch((e) => {
        if (__DEV__) console.warn('[Marmot] history replay failed:', e);
      });
    }
  } finally {
    perfLog('MLS/Marmot session hydration end');
  }
}
