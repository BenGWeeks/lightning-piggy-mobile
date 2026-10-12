import { getAppFormatLocale } from './appFormatLocale';
import type { ConversationMessage } from '../contexts/nostrContextTypes';
import type { DmInboxEntry } from './conversationSummaries';
import { dmRowPreview } from './dmRowPreview';

/**
 * The Messages-list entry for a locally sent message, or null when the list
 * will learn about it another way. Outgoing NIP-04 and Marmot sends have no
 * self-echo (the kind-4 inbox sub only matches #p = viewer; MLS never
 * delivers a member's own message back to it), so they must be added here;
 * NIP-17 sends arrive via their self-wrap echo, and received rows via the sub.
 */
export function localSendInboxEntry(
  partnerPubkey: string,
  msg: Pick<
    ConversationMessage,
    'id' | 'fromMe' | 'createdAt' | 'text' | 'wireKind' | 'protocol' | 'rumorId'
  >,
  locale?: string,
): DmInboxEntry | null {
  if (!msg.fromMe) return null;
  if (msg.protocol === 'marmot') {
    return {
      id: msg.id,
      partnerPubkey,
      fromMe: true,
      createdAt: msg.createdAt,
      text: dmRowPreview(msg.text, msg.wireKind ?? 14, locale),
      wireKind: msg.wireKind ?? 14,
      rumorId: msg.rumorId,
      protocol: 'marmot',
    };
  }
  if (msg.wireKind !== 4) return null;
  return {
    id: msg.id,
    partnerPubkey,
    fromMe: true,
    createdAt: msg.createdAt,
    text: msg.text,
    wireKind: 4,
  };
}

/** Imperative optimistic-inbox boundary using the committed app locale. */
export function localSendInboxEntryForApp(
  ...args: Parameters<typeof localSendInboxEntry>
): ReturnType<typeof localSendInboxEntry> {
  return localSendInboxEntry(args[0], args[1], args[2] ?? getAppFormatLocale());
}
