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
 *    notification, no remote push server is involved. Background wake-up
 *    (so we can decide to fire a notification while the UI isn't mounted)
 *    is done by `expo-background-task` — WorkManager on Android,
 *    BGTaskScheduler on iOS (see src/services/backgroundTask.ts) — both
 *    FCM-free. On Android there is ALSO an opt-in realtime path: a
 *    persistent foreground service holding a live relay socket
 *    (src/services/backgroundDmService.ts; manifest perms in
 *    plugins/withForegroundService.js) that posts content notifications
 *    the moment a message arrives — still local-only, no FCM.
 *
 * 2. Permission is requested once, from the foreground, at app launch via
 *    `requestNotificationPermission()`. Fire paths only ever *check*
 *    permission (`hasNotificationPermission()`) and never prompt — a
 *    headless/background task must not present a permission dialog.
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
// Low-importance channel for the persistent "watching for messages"
// foreground-service notification (#279 realtime upgrade). LOW so it
// never buzzes or pops a banner — it's the ongoing status chip Android
// requires a foreground service to display, not an alert. Kept on its
// own channel so the user can mute the chip independently of real
// message / payment alerts.
export const CHANNEL_BACKGROUND_SERVICE = 'background-service';

// Fixed notification id for the foreground-service ongoing chip. Stable
// so the background DM service can update (sender-name churn) or dismiss
// the same single notification rather than stacking duplicates.
export const FOREGROUND_SERVICE_NOTIFICATION_ID = 'lp-bg-dm-foreground';

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
export type NotificationKind = 'dm' | 'group' | 'payment' | 'zap' | 'cache';

/** Tap-routing data shipped with every notification. The deep-link
 * router (TODO — follow-up) reads these on tap to navigate to the
 * relevant screen. Optional fields by `kind`:
 *
 *  - dm        → conversationPubkey (open the 1:1 thread)
 *  - group     → groupId (open the group thread)
 *  - payment   → walletId (open that wallet's history)
 *  - zap       → conversationPubkey OR groupId (zap context)
 *  - cache     → cacheCoord (open the cache detail; #740)
 */
export interface NotificationData {
  conversationPubkey?: string;
  groupId?: string;
  walletId?: string;
  /** `<kind>:<pubkey>:<d>` coordinate of the geo-cache the find-log
   * targets. Read on tap to open HuntPiggyDetail (#740). */
  cacheCoord?: string;
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

let initialisingPromise: Promise<void> | null = null;
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
  // Memoise the in-flight init so concurrent callers await the SAME promise
  // and never return before the Android channels exist (Android drops a
  // notification scheduled before its channel is created). Resets to null on
  // failure so a transient error can be retried.
  if (initialisingPromise) return initialisingPromise;
  initialisingPromise = (async () => {
    try {
      await initialiseInternal();
    } catch (e) {
      initialisingPromise = null;
      throw e;
    }
  })();
  return initialisingPromise;
}

async function initialiseInternal(): Promise<void> {
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
      // PRIVATE = the notification appears on the lock screen but the OS
      // honours the user's system-level "hide sensitive content" setting.
      // We deliberately do NOT use SECRET here: SECRET hides the entry
      // entirely even after the user opts into lock-screen content via
      // `setLockScreenContentEnabled`, which would make that toggle a
      // no-op on Android. Body redaction is enforced in `fireNotification`
      // (generic copy substitution) regardless of channel visibility.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_PAYMENTS, {
      name: 'Payments',
      importance: Notifications.AndroidImportance.HIGH,
      description: 'Incoming Lightning, on-chain payments, and zaps',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    // Importance LOW = no sound, no heads-up banner. This is the channel
    // the persistent foreground-service chip rides on (#279 realtime
    // upgrade): Android requires a foreground service to show an ongoing
    // notification, but it should be a silent status chip, not an alert.
    await Notifications.setNotificationChannelAsync(CHANNEL_BACKGROUND_SERVICE, {
      name: 'Background message watch',
      importance: Notifications.AndroidImportance.LOW,
      description: 'The persistent status shown while Lightning Piggy watches for messages',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

/**
 * Check-only: is notification permission currently granted? Never
 * prompts. This is the ONLY permission call safe to make from a
 * background / headless context (a fire path), where presenting the
 * OS permission dialog is impossible and would throw or no-op.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  await ensureNotificationsInitialised();
  const existing = await Notifications.getPermissionsAsync();
  return existing.granted;
}

/**
 * Foreground-only permission request. MUST be called from a mounted UI
 * context (e.g. app launch in App.tsx) — never from the background sync
 * task, which cannot present a dialog. First call asks the OS; once the
 * user has been asked and denied (and can't be re-asked), subsequent
 * calls short-circuit so we never spin the dialog. Returns whether
 * permission is granted afterwards.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureNotificationsInitialised();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // `canAskAgain` becomes false when the user has tapped "Don't allow"
  // on iOS or denied with "Don't ask again" on Android 13+. Re-asking
  // would be a silent no-op and a UX miss; bail.
  if (existing.status === 'denied' && !existing.canAskAgain) return false;

  // We've asked before in a previous session AND been denied — don't
  // re-ask on every launch, only once per install.
  const alreadyAsked = await AsyncStorage.getItem(PERMISSION_REQUESTED_KEY);
  if (alreadyAsked === 'true' && existing.status === 'denied') return false;

  await AsyncStorage.setItem(PERMISSION_REQUESTED_KEY, 'true').catch(() => {});
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Privacy preference: should the real (decrypted) title/body be included in
 * notifications at all? Default OFF. When OFF, `fireNotification` substitutes
 * generic copy ("New message" / "Payment received") at SCHEDULE time, so the
 * plaintext never enters the OS notification store — it's hidden everywhere
 * (lock screen, shade, history), not just on the lock screen. This is the
 * cross-platform enforcement; the Android channels are `PRIVATE` (not
 * `SECRET`) so that, once the user opts in, the entry still shows and honours
 * their system "hide sensitive content" setting.
 *
 * Surfaced as the "notification content" toggle in
 * `src/screens/account/SecurityScreen.tsx`.
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

/** Map a `NotificationKind` to the Android channel id it should fire on.
 *
 * `cache` (find-logs on the user's geo-caches, #740) deliberately rides on
 * the existing Messages channel rather than introducing a third channel.
 * A new channel would orphan every user's existing per-channel mute
 * settings, and a find-log is conversationally similar to a DM (someone
 * pinging you about something you published) — the user who muted
 * Messages almost certainly wants find-logs muted too. If demand for an
 * independent "Hunt" channel surfaces, add it later with a careful
 * migration; until then sharing the channel is the lower-friction default.
 */
function channelForKind(kind: NotificationKind): string {
  switch (kind) {
    case 'dm':
    case 'group':
    case 'cache':
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
    case 'cache':
      return { title: 'New find on your cache', body: 'Open Lightning Piggy to view' };
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
 * after init), INCLUDING the background sync task — it only ever
 * *checks* permission (`hasNotificationPermission`), never prompts.
 */
export async function fireNotification(payload: NotificationPayload): Promise<string | null> {
  try {
    const granted = await hasNotificationPermission();
    if (!granted) return null;

    const lockScreenContent = await getLockScreenContentEnabled();
    // When privacy mode is on, present generic copy. Note the real body
    // is NOT carried in `data` — only routing metadata (kind + ids) is,
    // so the tap-router can reopen the right thread, which then loads the
    // actual message from the local store once the user has unlocked.
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
      // Android: a TIME_INTERVAL trigger is the supported way to pin a
      // notification to a specific channel (`channelId` lives on the trigger,
      // not the content). `trigger: null` fires immediately but drops the
      // notification onto the default channel, collapsing the Messages /
      // Payments split. The 1-second delay is imperceptible and the price of
      // keeping per-channel mute working. iOS has no channels → fire
      // immediately with `trigger: null`.
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

// --- Foreground-suppression state (#279) ---
//
// We never want to buzz the user about the very thread they're staring
// at. The app root drives `setNotificationsForeground` from AppState, and
// the open Conversation / GroupConversation screens drive
// `setActiveThread` on focus / blur. A message trigger then skips the
// notification only when the app is foreground AND the active thread is
// the one the message belongs to. Payments are never suppressed — money
// arriving is always worth surfacing.
let appInForeground = true;
let activeThreadId: string | null = null;
// #740: same idea as `activeThreadId` but keyed on the cache coordinate
// (`<kind>:<pubkey>:<d>`) so a find-log fired while the user is on that
// exact HuntPiggyDetail screen stays quiet. Kept independent of the
// thread id so a cache and a DM thread never collide on the same value.
let activeCacheCoord: string | null = null;

/** Called by the app root on AppState change. */
export function setNotificationsForeground(active: boolean): void {
  appInForeground = active;
}

/**
 * Called by Conversation / GroupConversation screens on focus (with the
 * partner pubkey or group id) and on blur (with `null`).
 */
export function setActiveThread(threadId: string | null): void {
  activeThreadId = threadId;
}

/** True when the app is foreground AND the user is viewing `threadId`. */
export function isThreadActivelyViewed(threadId: string): boolean {
  return appInForeground && activeThreadId === threadId;
}

/**
 * Called by HuntPiggyDetail / the navigation focus sync on focus (with the
 * cache coord) and on blur (with `null`). Mirrors `setActiveThread` (#740).
 */
export function setActiveCache(cacheCoord: string | null): void {
  activeCacheCoord = cacheCoord;
}

/** True when the app is foreground AND the user is viewing `cacheCoord`. */
export function isCacheActivelyViewed(cacheCoord: string): boolean {
  return appInForeground && activeCacheCoord === cacheCoord;
}

/**
 * Fire a message (DM or group) notification, suppressed when the user is
 * actively viewing that exact thread. `threadId` is the partner pubkey
 * (1:1) or the group id, and is also what the tap-router reads back to
 * reopen the thread.
 */
export async function fireMessageNotification(opts: {
  kind: 'dm' | 'group';
  threadId: string;
  title: string;
  body: string;
  data: NotificationData;
}): Promise<string | null> {
  if (isThreadActivelyViewed(opts.threadId)) return null;
  return fireNotification({
    kind: opts.kind,
    title: opts.title,
    body: opts.body,
    data: opts.data,
  });
}

/**
 * Fire a find-log notification (#740) — someone published a kind-1111
 * comment against one of the user's geo-caches (Piglet or vanilla
 * NIP-GC). Suppressed when the user is actively viewing the cache's
 * detail screen. `cacheCoord` is the addressable `<kind>:<pubkey>:<d>`
 * triple of the cache and is what the tap-router reads back to open
 * HuntPiggyDetail.
 *
 * The detect-and-ping background path (`runBackgroundSync`) calls this
 * with the sentinel `cacheCoord: '__background__'` — that value never
 * matches a real route, so the suppression gate always lets the ping
 * through and the router falls back to the Geo-caches list.
 */
export async function fireCacheNotification(opts: {
  cacheCoord: string;
  title: string;
  body: string;
}): Promise<string | null> {
  if (isCacheActivelyViewed(opts.cacheCoord)) return null;
  return fireNotification({
    kind: 'cache',
    title: opts.title,
    body: opts.body,
    data: { cacheCoord: opts.cacheCoord },
  });
}

/** Fire an incoming-payment / zap notification. Never suppressed. */
export async function firePaymentNotification(opts: {
  kind: 'payment' | 'zap';
  amountSats: number;
  walletId?: string;
  /** Zap comment / invoice memo, appended to the body when present. */
  comment?: string;
}): Promise<string | null> {
  const noun = opts.kind === 'zap' ? 'Zap' : 'Payment';
  const sats = opts.amountSats.toLocaleString();
  const trimmed = opts.comment?.trim();
  const body = trimmed ? `+${sats} sats · ${trimmed}` : `+${sats} sats received`;
  return fireNotification({
    kind: opts.kind,
    title: `${noun} received`,
    body,
    data: opts.walletId ? { walletId: opts.walletId } : undefined,
  });
}

/**
 * Post (or refresh) the persistent foreground-service status chip (#279
 * realtime upgrade). This is the ongoing "Lightning Piggy is watching for
 * messages" notification Android requires a foreground service to display.
 * Always uses a fixed identifier so repeated calls update the SAME entry
 * rather than stacking. The LOW-importance channel keeps it silent; it is
 * deliberately swipeable (see the `sticky` note below).
 *
 * Returns the notification id on success, or null if we couldn't post (no
 * permission yet, or expo-notifications threw). Android-only by intent — on
 * iOS there's no foreground service, so the background DM service never
 * calls this (see backgroundDmService.ts).
 */
export async function showForegroundServiceNotification(opts: {
  title: string;
  body: string;
}): Promise<string | null> {
  // Enforce the Android-only contract — on iOS there is no foreground
  // service, so a stray call must not schedule a phantom notification.
  if (Platform.OS !== 'android') return null;
  try {
    const granted = await hasNotificationPermission();
    if (!granted) return null;
    await Notifications.scheduleNotificationAsync({
      identifier: FOREGROUND_SERVICE_NOTIFICATION_ID,
      content: {
        title: opts.title,
        body: opts.body,
        // `kind: 'dm'` with no thread id routes a tap to the Messages list
        // (see navigateFromNotification) — the right landing place for a
        // "watching for messages" chip; unknown kinds would land on Home.
        data: { kind: 'dm' },
        // Deliberately NOT sticky: this JS-posted chip only exists on the
        // non-native fallback path, where the watch dies with the process —
        // an ongoing notification would then linger undismissably with no JS
        // left to clear it. Swipeable is honest; the native service's own
        // startForeground() chip covers the persistent case.
        sticky: false,
      },
      trigger:
        Platform.OS === 'android'
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              channelId: CHANNEL_BACKGROUND_SERVICE,
            }
          : null,
    });
    return FOREGROUND_SERVICE_NOTIFICATION_ID;
  } catch (err) {
    if (__DEV__)
      console.warn('[notificationService] showForegroundServiceNotification failed:', err);
    return null;
  }
}

/** Dismiss the persistent foreground-service status chip. Idempotent. */
export async function dismissForegroundServiceNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(FOREGROUND_SERVICE_NOTIFICATION_ID);
    // Also cancel a pending (not-yet-fired) schedule, since the 1 s
    // TIME_INTERVAL trigger above means a just-posted chip may still be
    // queued rather than displayed when the user toggles off fast.
    await Notifications.cancelScheduledNotificationAsync(FOREGROUND_SERVICE_NOTIFICATION_ID);
  } catch {
    // best-effort
  }
}

/**
 * Test hook: clears cached prefs so repeated tests don't poison each
 * other. NOT exported via barrel; intentionally only reachable via
 * deep import to keep production callers from grabbing it.
 */
export function __resetForTests(): void {
  initialisingPromise = null;
  cachedLockScreenContent = null;
  appInForeground = true;
  activeThreadId = null;
  activeCacheCoord = null;
}
