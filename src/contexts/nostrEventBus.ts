import { type GroupMessage } from '../services/groupMessagesStorageService';

/**
 * Tiny pub/sub for inbound group messages. NostrContext fires
 * `notifyGroupMessage` after persisting a decrypted group rumor so
 * GroupConversationScreen can re-load its in-memory list without
 * polling. Listeners are scoped to (groupId) so an open thread doesn't
 * re-render on unrelated traffic.
 */
type GroupMessageListener = (groupId: string, message: GroupMessage) => void;
const groupMessageListeners = new Set<GroupMessageListener>();
export function notifyGroupMessage(groupId: string, message: GroupMessage): void {
  for (const l of groupMessageListeners) {
    try {
      l(groupId, message);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] group message listener threw:', e);
    }
  }
}
export function subscribeGroupMessages(listener: GroupMessageListener): () => void {
  groupMessageListeners.add(listener);
  return () => {
    groupMessageListeners.delete(listener);
  };
}

// Sibling pub/sub for inbound 1:1 DM rumors (#349). Fires after a live
// kind-1059 wrap is decrypted to a single-recipient kind-14 rumor and
// committed to the inbox cache. The open ConversationScreen subscribes
// to its peer's pubkey so it can re-fetch and append the new message
// without waiting for the user to pull-to-refresh. `partnerPubkey` is
// the other party (lowercase hex); listeners filter on it.
type DmMessageListener = (partnerPubkey: string) => void;
const dmMessageListeners = new Set<DmMessageListener>();
export function notifyDmMessage(partnerPubkey: string): void {
  for (const l of dmMessageListeners) {
    try {
      l(partnerPubkey);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] dm message listener threw:', e);
    }
  }
}
export function subscribeDmMessages(listener: DmMessageListener): () => void {
  dmMessageListeners.add(listener);
  return () => {
    dmMessageListeners.delete(listener);
  };
}
