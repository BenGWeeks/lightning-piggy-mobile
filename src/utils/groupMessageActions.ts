import { classifyMessageContent } from './messageContent';
import type { GroupMessage } from '../services/groupMessagesStorageService';
import { isEditableGroupText } from '../services/groupMessagesStorageService';
import type { Item } from './conversationItems';

/** Adapt a stored group row to the shared message actions/reaction target. */
export function groupActionItem(
  message: GroupMessage,
  myPubkey: string | null,
): Extract<Item, { kind: 'message' }> {
  const ready = /^[0-9a-f]{64}$/i.test(message.id);
  return {
    kind: 'message',
    id: message.id,
    rumorId: ready ? message.id : undefined,
    fromMe: message.senderPubkey.toLowerCase() === myPubkey?.toLowerCase(),
    // Structured text/media can be reacted to or quoted, but must not expose
    // encryption keys through Copy or become editable plain text.
    text:
      isEditableGroupText(message.text) && classifyMessageContent(message.text).kind === 'text'
        ? message.text
        : '',
    wireKind: 14,
    createdAt: message.createdAt,
  };
}
