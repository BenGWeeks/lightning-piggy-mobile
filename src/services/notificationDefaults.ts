import AsyncStorage from '@react-native-async-storage/async-storage';

import { requestNotificationPermission } from './notificationService';
import { resolveNotificationDefaults } from '../utils/notificationDefaults';
import { enableMarmotPush, loadMarmotPushSettings } from './marmotPushRegistration';
import {
  beginDefaultSetup,
  isDefaultSetupCurrent,
  type DefaultSetupTask,
} from './notificationDefaultsTask';
import {
  loadWatcherState,
  saveWatcherState,
  WATCHER_PUSH_KEY_BASE,
  type WatcherAccountState,
} from './watcherPushStore';
import { anyCategory } from './watcherRegistration';
import { scheduleWatcherReconciliation } from './watcherPush';

const PUSH_PREFIX = 'marmot_push_enabled_v1_';
const EXPLICIT_PREFIX = 'notification_preference_explicit_v1_';
const WATCHER_PREFIX = `${WATCHER_PUSH_KEY_BASE}_`;
// Runs are serialised so two accounts can't both decide they are "first".
let chain: Promise<unknown> = Promise.resolve();
const running = new Map<string, Set<{ task: DefaultSetupTask; settled: Promise<void> }>>();

/** Account cleanup: abort `pubkey`'s tasks and wait for any write already
 * handed to storage to land, so the wipe that follows deletes it rather than
 * racing it. Nothing is recreated afterwards — an aborted task writes no more. */
export async function cancelNotificationDefaults(pubkey: string): Promise<void> {
  const runs = running.get(pubkey.toLowerCase());
  if (!runs) return;
  for (const run of runs) run.task.aborted = true;
  await Promise.all([...runs].map((run) => run.settled));
}

/** Called once Wallets is visible after sign-in. Resolves the missing
 * notification preferences for `pubkey` as one cancellable task: every write
 * (and the push runtime commit inside `enableMarmotPush`) checks that the
 * account is still the live one and that the user made no choice meanwhile.
 * The decision marker is the LAST write, so an interrupted run — a crash, a
 * cancelled token fetch, a failed write — retries at the next launch. */
export function initialiseNotificationDefaults(pubkey: string): Promise<void> {
  const task = beginDefaultSetup(pubkey);
  const run = chain.then(() => runDefaultSetup(task));
  const entry = { task, settled: run.catch(() => undefined) };
  const runs = running.get(task.pubkey) ?? new Set();
  runs.add(entry);
  running.set(task.pubkey, runs);
  chain = entry.settled;
  void entry.settled.then(() => {
    runs.delete(entry);
    if (runs.size === 0) running.delete(task.pubkey);
  });
  return run;
}

interface StoredChoices {
  /** '0' / '1', or null for no choice yet. */
  push: string | null;
  /** Raw watcher record, or null for no choice yet. */
  watcherRaw: string | null;
  watcher: WatcherAccountState;
  decided: boolean;
  otherAccountHasPreference: boolean;
}

async function readStoredChoices(me: string): Promise<StoredChoices> {
  const keys = await AsyncStorage.getAllKeys();
  const push = await AsyncStorage.getItem(`${PUSH_PREFIX}${me}`);
  const watcherRaw = await AsyncStorage.getItem(`${WATCHER_PREFIX}${me}`);
  const explicit = await AsyncStorage.getItem(`${EXPLICIT_PREFIX}${me}`);
  return {
    push,
    watcherRaw,
    watcher: await loadWatcherState(me),
    decided: explicit !== null || (push !== null && watcherRaw !== null),
    otherAccountHasPreference: keys.some((key) =>
      [PUSH_PREFIX, WATCHER_PREFIX, EXPLICIT_PREFIX].some(
        (prefix) => key.startsWith(prefix) && key.slice(prefix.length) !== me,
      ),
    ),
  };
}

/** One guarded write: checked immediately before it is handed to storage and
 * again once it landed. False means the task went stale — the caller stops,
 * and whatever did land is retried or cleaned up by the owner of that state. */
async function commit(task: DefaultSetupTask, write: () => Promise<void>): Promise<boolean> {
  if (!isDefaultSetupCurrent(task)) return false;
  await write();
  return isDefaultSetupCurrent(task);
}

async function runDefaultSetup(task: DefaultSetupTask): Promise<void> {
  const me = task.pubkey;
  const current = () => isDefaultSetupCurrent(task);
  if (!current()) return;
  // Local alerts need OS permission even when the push choices are already
  // saved, so this runs whether or not anything below does.
  await requestNotificationPermission();
  if (!current()) return;
  await loadMarmotPushSettings(me); // migrate the legacy device-wide preference first
  const stored = await readStoredChoices(me);
  if (stored.decided) return;
  const desired = resolveNotificationDefaults({
    preferences: {
      instant: stored.push === null ? null : stored.push === '1',
      more: stored.watcherRaw === null ? null : anyCategory(stored.watcher.categories),
    },
    otherAccountHasPreference: stored.otherAccountHasPreference,
  });
  if (!current()) return;
  if (stored.push === null && desired.instant) {
    // Token fetch + persistence + runtime commit, each guarded by the same task.
    const outcome = await enableMarmotPush(me, { interactive: false, stillActive: current });
    if (outcome.status !== 'enabled') return;
  }
  if (stored.watcherRaw === null) {
    const on = desired.more;
    const landed = await commit(task, () =>
      saveWatcherState(me, {
        ...stored.watcher,
        explicitlySet: false,
        categories: { dm: on, zap: on, mention: on, payment: on },
      }),
    );
    if (!landed) return;
    scheduleWatcherReconciliation(me);
  }
  if (stored.push === null && !desired.instant) {
    if (!(await commit(task, () => AsyncStorage.setItem(`${PUSH_PREFIX}${me}`, '0')))) return;
  }
  // The decision marker is the LAST write: '0' marks an automatic decision,
  // '1' an existing user choice. Anything missing before it retries next launch.
  await commit(task, () =>
    AsyncStorage.setItem(`${EXPLICIT_PREFIX}${me}`, stored.push !== null ? '1' : '0'),
  );
}
