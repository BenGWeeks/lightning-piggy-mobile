import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import type { NotificationData } from './notificationService';

export const MUTED_SENDERS_KEY = 'muted_notification_senders_v1';
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
const hex = /^[a-f0-9]{64}$/i;

/** Read storage rather than caching: background workers have a separate JS context. */
export async function loadMutedSenders(owner: string): Promise<ReadonlySet<string>> {
  const raw = await AsyncStorage.getItem(perAccountKey(MUTED_SENDERS_KEY, owner.toLowerCase()));
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed
            .filter((p): p is string => typeof p === 'string' && hex.test(p))
            .map((p) => p.toLowerCase())
        : [],
    );
  } catch {
    return new Set();
  }
}

/** Serialize toggles so rapid taps and different senders cannot overwrite one another. */
export function toggleMutedSender(owner: string, sender: string): Promise<void> {
  const pubkey = sender.toLowerCase();
  if (!hex.test(pubkey)) return Promise.reject(new Error('Invalid sender pubkey'));
  const run = queue.then(async () => {
    const next = new Set(await loadMutedSenders(owner));
    if (next.has(pubkey)) next.delete(pubkey);
    else next.add(pubkey);
    await AsyncStorage.setItem(
      perAccountKey(MUTED_SENDERS_KEY, owner.toLowerCase()),
      JSON.stringify([...next]),
    );
    listeners.forEach((listener) => listener());
  });
  queue = run.catch(() => {});
  return run;
}

export function subscribeMutedSenders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Only notification metadata is filtered; the Messages store is untouched. */
export function notificationSender(data: NotificationData, kind?: string): string | undefined {
  return (
    data.senderPubkey ?? (kind === 'dm' ? data.conversationPubkey : undefined)
  )?.toLowerCase();
}

export function isMutedNotification(
  data: NotificationData,
  kind: string | undefined,
  muted: ReadonlySet<string>,
): boolean {
  const sender = notificationSender(data, kind);
  return !!sender && muted.has(sender);
}

export async function shouldMuteNotification(
  owner: string | null | undefined,
  data: NotificationData | undefined,
  kind?: string,
): Promise<boolean> {
  if (!owner || !data || !notificationSender(data, kind)) return false;
  return isMutedNotification(data, kind, await loadMutedSenders(owner));
}
