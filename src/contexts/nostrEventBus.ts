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

// Sibling pub/sub for inbound kind-7516 found-logs on a cache the viewer
// OWNS (#760). Fires after the live owned-cache sub sees a fresh, deduped,
// non-self found-log so an open HuntPiggyDetail (or a future "my finds"
// surface) can refresh in-place without polling. `cacheCoord` is the
// `<kind>:<pubkey>:<d>` addressable triple the find-log targets; listeners
// filter on it. The notification side-effect lives in the hook that drives
// this — the bus only fans the event out to in-app listeners.
type FoundLogListener = (cacheCoord: string, logId: string) => void;
const foundLogListeners = new Set<FoundLogListener>();
export function notifyFoundLog(cacheCoord: string, logId: string): void {
  for (const l of foundLogListeners) {
    try {
      l(cacheCoord, logId);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] found-log listener threw:', e);
    }
  }
}
export function subscribeFoundLogEvents(listener: FoundLogListener): () => void {
  foundLogListeners.add(listener);
  return () => {
    foundLogListeners.delete(listener);
  };
}
