import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolveNotificationDefaults } from '../utils/notificationDefaults';
import { enableMarmotPush, loadMarmotPushSettings } from './marmotPushRegistration';
import { loadWatcherState, saveWatcherState, WATCHER_PUSH_KEY_BASE } from './watcherPushStore';
import { anyCategory } from './watcherRegistration';
import { scheduleWatcherReconciliation } from './watcherPush';

const PUSH_PREFIX = 'marmot_push_enabled_v1_';
const EXPLICIT_PREFIX = 'notification_preference_explicit_v1_';
const WATCHER_PREFIX = `${WATCHER_PUSH_KEY_BASE}_`;
let chain: Promise<unknown> = Promise.resolve();

/** Called only after Wallets is visible. Commit defaults after enablement
 * succeeds, so cancellation or token failure leaves setup retryable.
 * Existing enable machinery handles the token and schedules group records;
 * remote signers wait for Finish setup rather than launch-time approvals. */
export function initialiseNotificationDefaults(
  pubkey: string,
  stillActive: () => boolean,
): Promise<void> {
  const run = chain.then(async () => {
    const me = pubkey.toLowerCase();
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
    if (!stillActive()) return;
    if (ownPush === null && desired.instant) {
      const outcome = await enableMarmotPush(me, { interactive: false, stillActive });
      if (outcome.status !== 'enabled') return;
    }
    if (!stillActive()) return;
    // '0' marks an automatic decision, '1' marks a user choice. Both prevent
    // a default being reconsidered after an account switch or restart.
    await AsyncStorage.setItem(`${EXPLICIT_PREFIX}${me}`, ownPush !== null ? '1' : '0');
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
      scheduleWatcherReconciliation(me);
    }
    if (ownPush === null && !desired.instant) {
      await AsyncStorage.setItem(`${PUSH_PREFIX}${me}`, '0');
    }
  });
  chain = run.catch(() => undefined);
  return run;
}
