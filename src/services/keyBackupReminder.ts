// Weekly "Back up your key" reminder (#1546).
//
// For every account on this phone whose secret key lives in the app (a local
// "nsec" account) and that hasn't been marked backed up (keyBackupStatus.ts),
// one local notification repeats weekly at 10:00 local time. The first one
// fires at least 7 days after the account was first seen on this phone (the
// per-account "anchor", set by the first reconcile — for accounts that
// predate this feature, that's the first launch after it ships).
//
// Amber (NIP-55) and NIP-46 accounts never qualify: their key isn't in the
// app. Notification permission is never requested here — without it the
// reminders are cancelled and the Wallets tab shows a banner instead (see
// useKeyBackupReminder / shouldShowKeyBackupBanner).
//
// Trigger: expo-notifications' WEEKLY trigger (weekday + hour + minute; local
// time, supported on Android and iOS). A WEEKLY trigger fires at the next
// matching slot after it's armed, so during the ~day after the anchor — when
// that slot would land before the 7-day mark — a one-shot DATE trigger holds
// the first reminder instead, and a later reconcile swaps it for the weekly
// one (same identifier; rescheduling a WEEKLY trigger never shifts it).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as nip19 from 'nostr-tools/nip19';
import { t } from '../i18n';
import { loadIdentities } from './identitiesStore';
import { isKeyBackedUp } from './keyBackupStatus';
import { hasNotificationPermission } from './notificationService';
import { perAccountKey } from './perAccountStorage';
import type { NostrProfile } from '../types/nostr';

/** When this account was first seen on this phone (ms). Per account. */
export const REMINDER_ANCHOR_KEY_BASE = 'key_backup_reminder_anchor_v1';
/** Wallets-tab banner hidden until this time (ms). Per account. */
export const BANNER_SNOOZE_KEY_BASE = 'key_backup_banner_snooze_v1';
/** '0' = the user turned backup reminders off. Device-wide, default on. */
export const REMINDERS_ENABLED_KEY = 'key_backup_reminders_enabled_v1';
// Mirrors nostrCacheKeys.OWN_PROFILE_CACHE_KEY_BASE (not imported: that module
// lives under contexts/ and pulls in React Native scheduling helpers).
const OWN_PROFILE_CACHE_KEY_BASE = 'nostr_own_profile_cache';

export const REMINDER_ID_PREFIX = 'key-backup-';
export const REMINDER_KIND = 'keyBackup';
export const REMINDER_HOUR = 10;
const REMINDER_CHANNEL = 'reminders';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ReminderPlan =
  | { mode: 'once'; date: number }
  | { mode: 'weekly'; weekday: number; hour: number; minute: number };

interface ReminderData {
  kind: typeof REMINDER_KIND;
  keyBackupPubkey: string;
  /** Plan + copy fingerprint: an unchanged reminder is left alone. */
  reminderKey: string;
}

export function reminderId(pubkey: string): string {
  return `${REMINDER_ID_PREFIX}${pubkey.toLowerCase().slice(0, 16)}`;
}

/** The first REMINDER_HOUR:00 (local) at or after anchor + 7 days. */
export function firstReminderAt(anchor: number): number {
  const due = new Date(anchor + WEEK_MS);
  const slot = new Date(due);
  slot.setHours(REMINDER_HOUR, 0, 0, 0);
  if (slot.getTime() < due.getTime()) slot.setDate(slot.getDate() + 1);
  return slot.getTime();
}

/** Which trigger to arm at `now` for an account anchored at `anchor`. */
export function planReminder(anchor: number, now: number): ReminderPlan {
  const first = new Date(firstReminderAt(anchor));
  // A WEEKLY trigger armed now fires at the next matching slot after `now`.
  // Until the slot one week before the first reminder has passed, that would
  // be early — hold the first reminder in a one-shot instead. (Local-date
  // maths, so a DST change in between doesn't shift it by an hour.)
  const weekBefore = new Date(first);
  weekBefore.setDate(weekBefore.getDate() - 7);
  if (now <= weekBefore.getTime()) return { mode: 'once', date: first.getTime() };
  return {
    mode: 'weekly',
    // expo-notifications: 1 = Sunday … 7 = Saturday.
    weekday: first.getDay() + 1,
    hour: REMINDER_HOUR,
    minute: 0,
  };
}

function triggerFor(plan: ReminderPlan): Notifications.NotificationTriggerInput {
  const channelId = REMINDER_CHANNEL;
  return plan.mode === 'once'
    ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.date, channelId }
    : {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: plan.weekday,
        hour: plan.hour,
        minute: plan.minute,
        channelId,
      };
}

// ---------------------------------------------------------------------------
// Preferences + per-account state

export async function areKeyBackupRemindersEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REMINDERS_ENABLED_KEY)) !== '0';
  } catch {
    return true;
  }
}

/** Settings toggle. Off cancels every reminder (and hides the banner); on
 * schedules them for the accounts that qualify. */
export async function setKeyBackupRemindersEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(REMINDERS_ENABLED_KEY, enabled ? '1' : '0');
  if (enabled) await reconcileKeyBackupReminders();
  else await cancelAllKeyBackupReminders();
}

async function readNumber(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The account's anchor, set to `now` the first time it's asked for. */
export async function ensureReminderAnchor(pubkey: string, now: number): Promise<number> {
  const key = perAccountKey(REMINDER_ANCHOR_KEY_BASE, pubkey);
  const existing = await readNumber(key);
  if (existing !== null) return existing;
  await AsyncStorage.setItem(key, String(now)).catch(() => {});
  return now;
}

/** Display name from the account's cached kind-0, else a short npub. */
export async function accountDisplayName(pubkey: string): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pubkey));
    if (raw) {
      const p = JSON.parse(raw) as NostrProfile;
      const name = (p.displayName || p.name || '').trim();
      if (name) return name;
    }
  } catch {
    // Unreadable cache — fall through to the npub.
  }
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

// ---------------------------------------------------------------------------
// Scheduling

// Reconciles and cancellations run one at a time, so a cancel (backup
// confirmed, sign-out) can never be overtaken by a reconcile that read the
// account list before it.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.catch(() => undefined);
  return run;
}

// Signed-out accounts whose registry entry may not be gone yet (the cache
// wipe runs before removeIdentity): skipped until a reconcile sees them gone.
const retired = new Set<string>();

let channelReady: Promise<void> | null = null;
function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Reminders',
    description: 'Gentle reminders, like backing up your account key',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })
    .then(() => undefined)
    .catch((e) => {
      channelReady = null;
      throw e;
    });
  return channelReady;
}

async function scheduledReminders(): Promise<Notifications.NotificationRequest[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((r) => r.identifier.startsWith(REMINDER_ID_PREFIX));
}

async function cancelById(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  await Notifications.dismissNotificationAsync(id).catch(() => {});
}

/** Accounts that get the reminder: local-key accounts not marked backed up. */
export async function eligibleReminderAccounts(
  accounts: readonly { pubkey: string; signerType: string }[],
): Promise<string[]> {
  const out: string[] = [];
  for (const a of accounts) {
    if (a.signerType !== 'nsec' || retired.has(a.pubkey.toLowerCase())) continue;
    if (!(await isKeyBackedUp(a.pubkey))) out.push(a.pubkey);
  }
  return out;
}

/**
 * Bring the scheduled reminders in line with the accounts on this phone:
 * anchor new accounts, schedule (or update) a reminder for each eligible one,
 * cancel the rest. Idempotent — an unchanged reminder isn't touched. Never
 * throws and never prompts for permission.
 */
export function reconcileKeyBackupReminders(now: number = Date.now()): Promise<void> {
  return serial(async () => {
    try {
      const { identities } = await loadIdentities();
      const present = new Set(identities.map((i) => i.pubkey.toLowerCase()));
      for (const pk of retired) if (!present.has(pk)) retired.delete(pk);

      const eligible = await eligibleReminderAccounts(identities);
      // Anchor regardless of permission / toggle, so the first reminder (or
      // banner) still waits a week from when the account arrived.
      const anchors = new Map<string, number>();
      for (const pk of eligible) anchors.set(pk, await ensureReminderAnchor(pk, now));

      const enabled = await areKeyBackupRemindersEnabled();
      const permitted = enabled && eligible.length > 0 && (await hasNotificationPermission());
      const existing = await scheduledReminders();
      const wanted = new Set<string>();

      if (permitted) {
        await ensureReminderChannel();
        for (const pk of eligible) {
          const id = reminderId(pk);
          wanted.add(id);
          const plan = planReminder(anchors.get(pk)!, now);
          const title = t('keyBackupReminder.title');
          const body = t('keyBackupReminder.body', { name: await accountDisplayName(pk) });
          const reminderKey = JSON.stringify({ plan, title, body });
          const current = existing.find((r) => r.identifier === id);
          const currentData = current?.content.data as Partial<ReminderData> | undefined;
          if (currentData?.reminderKey === reminderKey) continue;
          if (current) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
          const data: ReminderData = { kind: REMINDER_KIND, keyBackupPubkey: pk, reminderKey };
          await Notifications.scheduleNotificationAsync({
            identifier: id,
            content: { title, body, data: data as unknown as Record<string, unknown> },
            trigger: triggerFor(plan),
          });
        }
      }
      for (const r of existing) {
        if (!wanted.has(r.identifier)) await cancelById(r.identifier);
      }
    } catch (e) {
      if (__DEV__) console.warn('[KeyBackupReminder] reconcile failed:', e);
    }
  });
}

/** Stop `pubkey`'s reminder — backup confirmed, or the signer changed. */
export function cancelKeyBackupReminder(pubkey: string): Promise<void> {
  return serial(() => cancelById(reminderId(pubkey)));
}

/** Sign-out / account removal: cancel and keep it cancelled until the
 * registry entry is gone (see `retired`). */
export function retireKeyBackupReminder(pubkey: string): Promise<void> {
  retired.add(pubkey.toLowerCase());
  return cancelKeyBackupReminder(pubkey);
}

/** Toggle off: cancel every scheduled reminder and clear delivered ones. */
export function cancelAllKeyBackupReminders(): Promise<void> {
  return serial(async () => {
    try {
      for (const r of await scheduledReminders()) await cancelById(r.identifier);
      const shown = await Notifications.getPresentedNotificationsAsync();
      for (const n of shown) {
        const id = n.request.identifier;
        if (id.startsWith(REMINDER_ID_PREFIX)) await cancelById(id);
      }
    } catch (e) {
      if (__DEV__) console.warn('[KeyBackupReminder] cancel-all failed:', e);
    }
  });
}

// ---------------------------------------------------------------------------
// In-app fallback banner (notifications off)

/**
 * Whether the Wallets tab should show the "Back up your key" banner for the
 * active account: reminders on, a local-key account not backed up, at least
 * a week since it arrived, not snoozed — and notifications NOT allowed (with
 * them allowed, the weekly notification does this job instead).
 */
export async function shouldShowKeyBackupBanner(
  pubkey: string | null | undefined,
  signerType: string | null | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (!pubkey || signerType !== 'nsec') return false;
  if (!(await areKeyBackupRemindersEnabled())) return false;
  if (await isKeyBackedUp(pubkey)) return false;
  const anchor = await readNumber(perAccountKey(REMINDER_ANCHOR_KEY_BASE, pubkey));
  if (anchor === null || now < anchor + WEEK_MS) return false;
  const snoozedUntil = await readNumber(perAccountKey(BANNER_SNOOZE_KEY_BASE, pubkey));
  if (snoozedUntil !== null && now < snoozedUntil) return false;
  try {
    return !(await hasNotificationPermission());
  } catch {
    return true;
  }
}

/** Dismiss = hide the banner for a week. */
export async function snoozeKeyBackupBanner(
  pubkey: string,
  now: number = Date.now(),
): Promise<void> {
  await AsyncStorage.setItem(perAccountKey(BANNER_SNOOZE_KEY_BASE, pubkey), String(now + WEEK_MS));
}

export function __resetKeyBackupReminderForTests(): void {
  chain = Promise.resolve();
  retired.clear();
  channelReady = null;
}
