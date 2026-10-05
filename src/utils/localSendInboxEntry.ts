import type { ConversationMessage } from '../contexts/nostrContextTypes';
import type { DmInboxEntry } from './conversationSummaries';

/**
 * The Messages-list entry for a locally sent message, or null when the list
 * will learn about it another way. An outgoing NIP-04 send has no self-echo
 * (the kind-4 inbox sub only matches #p = viewer), so it must be added here;
 * NIP-17 sends arrive via their self-wrap echo, and received rows via the sub.
 */
export function localSendInboxEntry(
  partnerPubkey: string,
  msg: Pick<ConversationMessage, 'id' | 'fromMe' | 'createdAt' | 'text' | 'wireKind'>,
): DmInboxEntry | null {
  if (!msg.fromMe || msg.wireKind !== 4) return null;
  return {
    id: msg.id,
    partnerPubkey,
    fromMe: true,
    createdAt: msg.createdAt,
    text: msg.text,
    wireKind: 4,
  };
}
