import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import type { NotificationData, NotificationKind } from './notificationService';

/**
 * In-app history of the notifications the app fired (#1143), so one seen on
 * the lock screen — or swiped away — can still be found and opened. Local
 * only, per account, capped by age and count.
 *
 * Privacy: message bodies are never stored (a DM / group row keeps its title,
 * e.g. the sender or group name, plus routing ids); payment-style rows keep
 * their short body (e.g. an amount), which is not message content.
 */
export interface NotificationHistoryEntry {
  id: string;
  kind: NotificationKind;
  title: string;
  /** Short detail for non-message kinds; never a DM / group message body. */
  body?: string;
  /** Routing ids — what `navigateFromNotification` reads to open the source. */
  data: NotificationData;
  /** Epoch ms. */
  createdAt: number;
  read: boolean;
  /** Source id (e.g. a payment hash): a retry with the same key is ignored. */
  key?: string;
}

export const NOTIFICATION_HISTORY_KEY_BASE = 'notification_history_v1';
export const MAX_ENTRIES = 200;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Listener = () => void;
const listeners = new Set<Listener>();
// Serialise read-modify-write so concurrent records can't drop each other.
let queue: Promise<unknown> = Promise.resolve();

const keyFor = (pubkey: string) => perAccountKey(NOTIFICATION_HISTORY_KEY_BASE, pubkey);

async function read(pubkey: string): Promise<NotificationHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(pubkey));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as NotificationHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Newest first, within the age and count caps. */
export function pruneHistory(
  entries: NotificationHistoryEntry[],
  now = Date.now(),
): NotificationHistoryEntry[] {
  return entries
    .filter((e) => now - e.createdAt <= MAX_AGE_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
}

function update(
  pubkey: string,
  change: (entries: NotificationHistoryEntry[]) => NotificationHistoryEntry[],
): Promise<void> {
  const run = queue.then(async () => {
    const next = pruneHistory(change(await read(pubkey)));
    await AsyncStorage.setItem(keyFor(pubkey), JSON.stringify(next)).catch(() => {});
    listeners.forEach((l) => l());
  });
  queue = run.catch(() => {});
  return run;
}

/** Record a fired notification. Best-effort; a no-op without an account. */
export function recordNotification(
  pubkey: string | null,
  entry: {
    kind: NotificationKind;
    title: string;
    body: string;
    data?: NotificationData;
    historyKey?: string;
    /** Shared with the tray notification's `data.historyId`. */
    id?: string;
  },
  now = Date.now(),
): Promise<void> {
  if (!pubkey) return Promise.resolve();
  const isMessage = entry.kind === 'dm' || entry.kind === 'group';
  const record: NotificationHistoryEntry = {
    id: entry.id ?? entry.historyKey ?? `${now}-${Math.random().toString(36).slice(2, 10)}`,
    kind: entry.kind,
    title: entry.title,
    ...(isMessage ? {} : { body: entry.body }),
    data: entry.data ?? {},
    createdAt: now,
    read: false,
    ...(entry.historyKey ? { key: entry.historyKey } : {}),
  };
  return update(pubkey, (entries) =>
    record.key && entries.some((e) => e.key === record.key) ? entries : [record, ...entries],
  ).catch(() => {});
}

export async function listNotifications(pubkey: string): Promise<NotificationHistoryEntry[]> {
  await queue;
  return pruneHistory(await read(pubkey));
}

export function markNotificationRead(pubkey: string, id: string): Promise<void> {
  return update(pubkey, (entries) => entries.map((e) => (e.id === id ? { ...e, read: true } : e)));
}

/** Mark every entry `match` selects as read (no write when none change). */
export function markNotificationsReadWhere(
  pubkey: string,
  match: (entry: NotificationHistoryEntry) => boolean,
): Promise<void> {
  return update(pubkey, (entries) =>
    entries.some((e) => !e.read && match(e))
      ? entries.map((e) => (!e.read && match(e) ? { ...e, read: true } : e))
      : entries,
  );
}

export function markAllNotificationsRead(pubkey: string): Promise<void> {
  return update(pubkey, (entries) => entries.map((e) => (e.read ? e : { ...e, read: true })));
}

/** Delete an account's history (sign-out / identity removal). Runs through
 * the write queue so a pending record can't recreate it afterwards. */
export function clearNotificationHistory(pubkey: string): Promise<void> {
  const run = queue.then(async () => {
    await AsyncStorage.removeItem(keyFor(pubkey)).catch(() => {});
    listeners.forEach((l) => l());
  });
  queue = run.catch(() => {});
  return run;
}

export function subscribeNotificationHistory(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset of the module-level write queue and listeners. */
export function __resetNotificationHistoryForTests(): void {
  queue = Promise.resolve();
  listeners.clear();
}
