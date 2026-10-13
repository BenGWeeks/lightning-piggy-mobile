import AsyncStorage from '@react-native-async-storage/async-storage';

import { requestNotificationPermission } from './notificationService';
import { resolveNotificationDefaults } from '../utils/notificationDefaults';
import { enableMarmotPush, loadMarmotPushSettings } from './marmotPushRegistration';
import { loadWatcherState, saveWatcherState, WATCHER_PUSH_KEY_BASE } from './watcherPushStore';
import { anyCategory } from './watcherRegistration';
import { scheduleWatcherReconciliation } from './watcherPush';

const PUSH_PREFIX = 'marmot_push_enabled_v1_';
const EXPLICIT_PREFIX = 'notification_preference_explicit_v1_';
const WATCHER_PREFIX = `${WATCHER_PUSH_KEY_BASE}_`;
let chain: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Set<{ cancel: () => void; settled: Promise<void> }>>();

/** Drain writes already submitted to storage before account cleanup deletes them. */
export async function cancelNotificationDefaults(pubkey: string): Promise<void> {
  const runs = pending.get(pubkey.toLowerCase());
  if (!runs) return;
  for (const run of runs) run.cancel();
  await Promise.all([...runs].map((run) => run.settled));
}

/** Called only after Wallets is visible. Commit defaults after enablement
 * succeeds, so cancellation or token failure leaves setup retryable.
 * Existing enable machinery handles the token and schedules group records;
 * remote signers wait for Finish setup rather than launch-time approvals. */
export function initialiseNotificationDefaults(
  pubkey: string,
  stillActive: () => boolean,
): Promise<void> {
  const me = pubkey.toLowerCase();
  let cancelled = false;
  const accountActive = () => !cancelled && stillActive();
  const run = chain.then(async () => {
    if (!accountActive()) return;
    // Local alerts need OS permission even when push choices are already saved.
    await requestNotificationPermission();
    if (!accountActive()) return;
    await loadMarmotPushSettings(me); // migrate the legacy device-wide preference first
    const keys = await AsyncStorage.getAllKeys();
    const ownPush = await AsyncStorage.getItem(`${PUSH_PREFIX}${me}`);
    const ownWatcher = await AsyncStorage.getItem(`${WATCHER_PREFIX}${me}`);
    const ownExplicit = await AsyncStorage.getItem(`${EXPLICIT_PREFIX}${me}`);
    if (ownExplicit !== null || (ownPush !== null && ownWatcher !== null)) return;
    const otherAccountHasPreference = keys.some((key) =>
      [PUSH_PREFIX, WATCHER_PREFIX, EXPLICIT_PREFIX].some(
        (prefix) => key.startsWith(prefix) && key.slice(prefix.length) !== me,
      ),
    );
    const watcher = await loadWatcherState(me);
    const desired = resolveNotificationDefaults({
      preferences: {
        instant: ownPush === null ? null : ownPush === '1',
        more: ownWatcher === null ? null : anyCategory(watcher.categories),
      },
      otherAccountHasPreference,
    });
    if (!accountActive()) return;
    if (ownPush === null && desired.instant) {
      const outcome = await enableMarmotPush(me, {
        interactive: false,
        stillActive: accountActive,
      });
      if (outcome.status !== 'enabled') return;
    }
    if (!accountActive()) return;
    if (ownWatcher === null) {
      await saveWatcherState(me, {
        ...watcher,
        explicitlySet: false,
        categories: {
          dm: desired.more,
          zap: desired.more,
          mention: desired.more,
          payment: desired.more,
        },
      });
      if (!accountActive()) return;
      scheduleWatcherReconciliation(me);
    }
    if (ownPush === null && !desired.instant) {
      if (!accountActive()) return;
      await AsyncStorage.setItem(`${PUSH_PREFIX}${me}`, '0');
    }
    // Commit the decision last: partial writes must retry the missing preferences.
    // '0' marks an automatic decision, '1' marks an existing user choice.
    if (!accountActive()) return;
    await AsyncStorage.setItem(`${EXPLICIT_PREFIX}${me}`, ownPush !== null ? '1' : '0');
  });
  const entry = { cancel: () => (cancelled = true), settled: run.catch(() => undefined) };
  const runs = pending.get(me) ?? new Set();
  runs.add(entry);
  pending.set(me, runs);
  chain = entry.settled;
  void entry.settled.then(() => {
    runs.delete(entry);
    if (runs.size === 0) pending.delete(me);
  });
  return run;
}
