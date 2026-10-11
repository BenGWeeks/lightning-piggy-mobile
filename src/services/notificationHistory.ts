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
  /** Its tray notification was posted (so a repeat needn't post another). */
  delivered?: boolean;
  /** Thread the row stands for: a new message there updates this row while
   * it is unread, instead of stacking one row per message. */
  collapse?: string;
  /** How many messages an updated (collapsed) row stands for. */
  count?: number;
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
    const current = await read(pubkey);
    const changed = change(current);
    // Unchanged (same array back): skip the write and the listener re-reads.
    if (changed === current) return;
    const next = pruneHistory(changed);
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
    /** Unread row of the same thread to update instead of adding a row. */
    collapseKey?: string;
  },
  now = Date.now(),
): Promise<{ duplicateDelivered: boolean; id: string; count: number }> {
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
    ...(entry.collapseKey ? { collapse: entry.collapseKey } : {}),
  };
  const fresh = { duplicateDelivered: false, id: record.id, count: 1 };
  if (!pubkey) return Promise.resolve(fresh);
  // A repeat of a source already shown in the tray is reported, so the caller
  // can skip a second tray entry; one whose tray post failed is retried.
  let duplicateDelivered = false;
  let id = record.id;
  let count = 1;
  return update(pubkey, (entries) => {
    const existing = record.key ? entries.find((e) => e.key === record.key) : undefined;
    if (existing) {
      duplicateDelivered = existing.delivered === true;
      return entries;
    }
    // Another message in a thread with an unread row: that row now stands for
    // both (newest title / routing, moved to the top) — a burst from one
    // sender is one row, not twenty.
    const open = record.collapse
      ? entries.find((e) => !e.read && e.collapse === record.collapse)
      : undefined;
    if (!open) return [record, ...entries];
    id = open.id;
    count = (open.count ?? 1) + 1;
    const merged = { ...record, id, count };
    return [merged, ...entries.filter((e) => e !== open)];
  })
    .then(() => ({ duplicateDelivered, id, count }))
    .catch(() => fresh);
}

/**
 * Rewrite entries in place: `change` returns the replacement entry, `null` to
 * delete it, or the entry itself to keep it. One write; none when nothing
 * changed. Resolves with the ids deleted. Lets a placeholder row be turned
 * into the real one rather than deleted in the hope another is written.
 */
export function rewriteNotifications(
  pubkey: string,
  change: (entry: NotificationHistoryEntry) => NotificationHistoryEntry | null,
): Promise<string[]> {
  let removed: string[] = [];
  return update(pubkey, (entries) => {
    removed = [];
    let touched = false;
    const next: NotificationHistoryEntry[] = [];
    for (const e of entries) {
      const out = change(e);
      if (out !== e) touched = true;
      if (out) next.push(out);
      else removed.push(e.id);
    }
    return touched ? next : entries;
  })
    .then(() => removed)
    .catch(() => []);
}

/** Delete every entry `match` selects (no write when none match); resolves
 * with the removed ids. For alerts that turned out to show nothing — e.g. a
 * generic "New message" superseded by the real one. */
export function removeNotificationsWhere(
  pubkey: string,
  match: (entry: NotificationHistoryEntry) => boolean,
): Promise<string[]> {
  let removed: string[] = [];
  return update(pubkey, (entries) => {
    removed = entries.filter(match).map((e) => e.id);
    return removed.length ? entries.filter((e) => !match(e)) : entries;
  })
    .then(() => removed)
    .catch(() => []);
}

/** Note that an entry's tray notification was posted. */
export function markNotificationDelivered(pubkey: string, id: string): Promise<void> {
  return update(pubkey, (entries) =>
    entries.map((e) => (e.id === id && !e.delivered ? { ...e, delivered: true } : e)),
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
