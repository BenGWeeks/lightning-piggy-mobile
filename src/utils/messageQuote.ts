import { dmRowPreview } from './dmRowPreview';
import { sanitizeDisplayText } from './sanitizeDisplayText';

/** The quoted parent of a reply, as shown above the reply's text. */
export interface MessageQuote {
  /** Preview of the parent message; null when it isn't in the loaded thread
   * (older than the loaded slice, or deleted). */
  text: string | null;
  /** Whether the parent was authored by us (picks "You" vs the peer's tint). */
  fromMe: boolean;
  /** Who wrote the parent when it isn't us: the member's name in a group,
   * the contact's name in a 1:1 (filled by the row). Else "Someone". */
  authorName?: string;
}

interface QuotableMessage {
  id: string;
  rumorId?: string;
  fromMe: boolean;
  text: string;
  wireKind?: number;
}

/** Index a thread's messages by every id a reply may name (Marmot app-event id). */
export function indexMessagesById<T extends QuotableMessage>(
  messages: readonly T[],
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const m of messages) {
    byId.set(m.id, m);
    if (m.rumorId) byId.set(m.rumorId, m);
  }
  return byId;
}

/**
 * The quote for a reply to `replyTo`, resolved against the thread. The
 * preview goes through `dmRowPreview`, so a quoted photo / poll / secret-bearing
 * row shows its safe label, never raw content.
 */
export function resolveQuote(
  replyTo: string | undefined,
  byId: ReadonlyMap<string, QuotableMessage>,
): MessageQuote | undefined {
  if (!replyTo) return undefined;
  const parent = byId.get(replyTo);
  if (!parent) return { text: null, fromMe: false };
  // Sanitised like the bubble itself, so a U+FFFC placeholder (#764) never
  // shows as a box in the quote.
  const text = dmRowPreview(sanitizeDisplayText(parent.text), parent.wireKind ?? 14);
  return { text, fromMe: parent.fromMe };
}

/** A 1:1 quote names the contact when the parent isn't ours (`authorName`
 * is only known up front in groups). */
export function withPeerName(
  quote: MessageQuote | undefined,
  peerName: string | undefined,
): MessageQuote | undefined {
  if (!quote || quote.fromMe || quote.authorName || !peerName) return quote;
  return { ...quote, authorName: peerName };
}
