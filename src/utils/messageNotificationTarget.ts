import type { NotificationData } from '../services/notificationService';

/**
 * Where a tap on an undecrypted message alert should go (#1154), from the new
 * events alone:
 *  - all kind-4 (NIP-04) from one sender → that conversation (the author is
 *    public, so no decryption is needed);
 *  - a single kind-1059 (NIP-17) gift wrap → its id, resolved to a
 *    conversation once the app has decrypted it;
 *  - anything else (several senders, several wraps, orders) → the list.
 */
export function messageNotificationTarget(
  events: readonly { id: string; kind: number; pubkey: string }[],
): NotificationData {
  if (events.length === 0) return {};
  const senders = new Set(events.map((e) => e.pubkey.toLowerCase()));
  if (events.every((e) => e.kind === 4) && senders.size === 1)
    return { conversationPubkey: [...senders][0], conversationProtocol: 'nip04' };
  if (events.length === 1 && events[0].kind === 1059) return { wrapId: events[0].id };
  return {};
}
