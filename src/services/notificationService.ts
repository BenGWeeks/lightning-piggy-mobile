/**
 * notificationService — single integration point for OS-level
 * notifications surfaced from anywhere in the app (DM rumors, group
 * messages, incoming on-chain / Lightning payments, zaps).
 *
 * Architectural commitments (see docs/architecture/notifications.adoc):
 *
 * 1. NO Firebase / FCM / Google Play Services dependency. The app must
 *    work on GrapheneOS, microG, and other un-googled devices. We use
 *    `expo-notifications` LOCAL notifications only — the OS renders the
 *    notification, no remote push server is involved. The actual
 *    "wake the JS runtime so we can decide to fire a notification"
 *    work is done by an Android foreground service (see
 *    plugins/withForegroundService.js) on Android and BGTaskScheduler
 *    on iOS, both of which are FCM-free.
 *
 * 2. Permission flow is LAZY — we don't ask on app boot. Permission is
 *    requested the first time a feature wants to fire a notification
 *    (e.g. first inbound DM rumor decrypted in the background). Less
 *    blunt + a higher conversion rate per the issue #279 discussion.
 *
 * 3. Per-channel mute. Android 8+ channels split notifications into
 *    "Messages" and "Payments" so the user can mute one without the
 *    other from system Settings. Per-channel UI inside the app is a
 *    follow-up.
 *
 * 4. Privacy. Notification body content (e.g. decrypted DM plaintext)
 *    is NOT sent to the lock screen by default — we show a generic
 *    "New message" until the user explicitly opts in. See
 *    `setLockScreenContentEnabled`.
 *
 * 5. Generic foundation. Callers fire typed `NotificationPayload`
 *    objects rather than each call site assembling raw expo arguments.
 *    This is the seam that lets us swap the backing library or add
 *    grouping / quiet hours / badge counts later without touching the
 *    triggers.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// Android notification channel ids. Stable strings — changing them
// orphans the user's per-channel mute state in system Settings.
const CHANNEL_MESSAGES = 'messages';
const CHANNEL_PAYMENTS = 'payments';

// Persisted user preferences for notification behaviour. Defaults are
// privacy-preserving (lock-screen body content OFF) per constraint #4
// from issue #279.
const LOCK_SCREEN_CONTENT_KEY = 'notif_pref_lockscreen_content_v1';
const PERMISSION_REQUESTED_KEY = 'notif_pref_permission_asked_v1';

/** Discriminator for the notification's source. Drives:
 *  - which Android channel it lands in (`messages` vs `payments`)
 *  - default title / icon when the caller doesn't override
 *  - tap-routing decisions (see `data` payload below)
 *
 * Add a new kind here BEFORE adding a new caller — keeps the routing
 * logic exhaustive.
 */
export type NotificationKind = 'dm' | 'group' | 'payment' | 'zap';

/** Tap-routing data shipped with every notification. The deep-link
 * router (TODO — follow-up) reads these on tap to navigate to the
 * relevant screen. Optional fields by `kind`:
 *
 *  - dm        → conversationPubkey (open the 1:1 thread)
 *  - group     → groupId (open the group thread)
 *  - payment   → walletId (open that wallet's history)
 *  - zap       → conversationPubkey OR groupId (zap context)
 */
export interface NotificationData {
  conversationPubkey?: string;
  groupId?: string;
  walletId?: string;
}

/** Typed payload every caller passes to `fireNotification`. Centralising
 * this shape is the whole point of this service — call sites should
 * NEVER reach into expo-notifications directly. */
export interface NotificationPayload {
  kind: NotificationKind;
  title: string;
  /** Plaintext body. May be redacted on the lock screen — see
   * `setLockScreenContentEnabled` / `getLockScreenContentEnabled`. */
  body: string;
  data?: NotificationData;
}

let initialised = false;
let cachedLockScreenContent: boolean | null = null;

/**
 * Idempotent. Sets the foreground-presentation behaviour and creates
 * the Android channels. Safe to call from anywhere; subsequent calls
 * are no-ops.
 *
 * Foreground behaviour: we DO show notifications in the foreground
 * (`shouldShowBanner: true`) because the app's tab structure means a
 * user reading their wallet won't see a new DM unless we surface it.
 * If this gets noisy (e.g. they're actively in the conversation),
 * the trigger site is responsible for skipping the call — not the
 * presentation layer.
 */
export async function ensureNotificationsInitialised(): Promise<void> {
  if (initialised) return;
  initialised = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    // Channel importance HIGH = pop-up banner + sound. Users can mute
    // either channel from system Settings without affecting the other.
    // Group payment notifications onto their own channel so a user who
    // wants payment alerts but no message alerts (or vice versa) can
    // configure that without uninstalling the app.
    await Notifications.setNotificationChannelAsync(CHANNEL_MESSAGES, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      // Show the channel description in system Settings so the user
      // knows what each channel covers when they go to mute one.
      description: 'New direct messages and group messages',
      // Lock-screen visibility: SECRET = body fully hidden until
      // unlock. We override per-notification when the user has opted
      // into lock-screen content. Channel default = privacy-preserving.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_PAYMENTS, {
      name: 'Payments',
      importance: Notifications.AndroidImportance.HIGH,
      description: 'Incoming Lightning, on-chain payments, and zaps',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    });
  }
}

/**
 * Lazy permission request. First call asks the OS; subsequent calls
 * short-circuit on the cached "already asked" flag so we never re-prompt
 * on every event. Returns whether permission is currently granted.
 *
 * Per issue #279, callers should invoke this on the first relevant
 * event — NOT on app boot.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  await ensureNotificationsInitialised();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // `canAskAgain` becomes false when the user has tapped "Don't allow"
  // on iOS or denied with "Don't ask again" on Android 13+. Re-asking
  // would be a silent no-op and a UX miss; bail.
  if (existing.status === 'denied' && !existing.canAskAgain) return false;

  // We've asked before in a previous session AND been denied — don't
  // re-ask on every event in this session, only once per install.
  // Re-prompting is a per-OS dialog so we shouldn't drive it ourselves.
  const alreadyAsked = await AsyncStorage.getItem(PERMISSION_REQUESTED_KEY);
  if (alreadyAsked === 'true' && existing.status === 'denied') return false;

  await AsyncStorage.setItem(PERMISSION_REQUESTED_KEY, 'true').catch(() => {});
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Privacy preference: should the decrypted body text be shown on the
 * lock screen? Default OFF. When OFF, the OS still shows that A
 * notification arrived (with the channel name + a generic title), but
 * the body collapses to a placeholder — chosen by the OS on Android
 * (channel `lockscreenVisibility: SECRET`) and by the placeholder
 * substitution we do here on iOS.
 *
 * Toggle is exposed as a future Settings UI element (TODO — follow-up
 * issue).
 */
export async function getLockScreenContentEnabled(): Promise<boolean> {
  if (cachedLockScreenContent !== null) return cachedLockScreenContent;
  const raw = await AsyncStorage.getItem(LOCK_SCREEN_CONTENT_KEY).catch(() => null);
  cachedLockScreenContent = raw === 'true';
  return cachedLockScreenContent;
}

export async function setLockScreenContentEnabled(enabled: boolean): Promise<void> {
  cachedLockScreenContent = enabled;
  await AsyncStorage.setItem(LOCK_SCREEN_CONTENT_KEY, enabled ? 'true' : 'false').catch(() => {});
}

/** Map a `NotificationKind` to the Android channel id it should fire on. */
function channelForKind(kind: NotificationKind): string {
  switch (kind) {
    case 'dm':
    case 'group':
      return CHANNEL_MESSAGES;
    case 'payment':
    case 'zap':
      return CHANNEL_PAYMENTS;
  }
}

/** Generic title / body to use when the user has lock-screen content
 * disabled. Picked per-kind so the notification still tells the user
 * roughly what happened ("New message" vs "Payment received") without
 * leaking specifics. */
function genericFor(kind: NotificationKind): { title: string; body: string } {
  switch (kind) {
    case 'dm':
      return { title: 'New message', body: 'Open Lightning Piggy to read' };
    case 'group':
      return { title: 'New group message', body: 'Open Lightning Piggy to read' };
    case 'payment':
      return { title: 'Payment received', body: 'Open Lightning Piggy for details' };
    case 'zap':
      return { title: 'Zap received', body: 'Open Lightning Piggy for details' };
  }
}

/**
 * Fire a local notification.
 *
 * Returns the scheduled-notification id on success, or `null` if we
 * couldn't fire (no permission yet, or expo-notifications threw).
 * We swallow exceptions — a notification failing should never crash
 * the trigger path that called us.
 *
 * Concurrency: safe to call from anywhere (no shared mutable state
 * after init). The `ensureNotificationsInitialised` call inside
 * `ensureNotificationPermission` short-circuits after first invocation.
 */
export async function fireNotification(payload: NotificationPayload): Promise<string | null> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return null;

    const lockScreenContent = await getLockScreenContentEnabled();
    // When privacy mode is on, present generic copy. The full payload
    // still rides in `data` so the in-app screen we route to on tap
    // can render the real content once the user has unlocked.
    const presented = lockScreenContent ? payload : { ...payload, ...genericFor(payload.kind) };

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: presented.title,
        body: presented.body,
        // `data` rides through to the tap handler. Always include
        // `kind` so the deep-link router can dispatch by source.
        data: { kind: payload.kind, ...(payload.data ?? {}) },
        sound: 'default',
      },
      trigger:
        Platform.OS === 'android'
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              channelId: channelForKind(payload.kind),
            }
          : null,
    });
    return id;
  } catch (err) {
    if (__DEV__) console.warn('[notificationService] fireNotification failed:', err);
    return null;
  }
}

/**
 * Test hook: clears cached prefs so repeated tests don't poison each
 * other. NOT exported via barrel; intentionally only reachable via
 * deep import to keep production callers from grabbing it.
 */
export function __resetForTests(): void {
  initialised = false;
  cachedLockScreenContent = null;
}
