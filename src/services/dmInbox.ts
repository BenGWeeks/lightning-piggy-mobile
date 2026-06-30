import { getInboxLatest, getConversationMessages, type DmMessageRow } from './dmDb';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { orderPreviewFromContent } from '../utils/orderEvents';

// The read seam between the encrypted DM store (dmDb) and the Messages UI
// (#695 step 3b). NostrContext delegates here instead of walking a giant
// in-memory blob: loadInboxEntries() is the indexed per-conversation latest
// read that replaces the O(whole-inbox) parse that froze the Messages tab,
// and loadConversationEntries() is the paginated thread read.
//
// Mapping is 1:1 now that dmDb stores from_me + wire_kind — the row carries
// everything DmInboxEntry needs, so no pubkey threading or kind assumptions.
// Follow-gating is NOT applied here: it belongs at ingest (the decryptor) or
// as a future read filter, so the "include non-follows" toggle can work
// without re-fetching. Keep this layer a pure projection.

const rowToInboxEntry = (r: DmMessageRow): DmInboxEntry => ({
  id: r.eventId,
  partnerPubkey: r.conversation,
  fromMe: r.fromMe,
  createdAt: r.createdAt,
  // A kind-16/17 order row stores order JSON in `content`; surface a readable
  // one-line summary in the preview instead of the raw blob. Other rows pass
  // their plaintext through unchanged (#market).
  text: orderPreviewFromContent(r.content, r.wireKind),
  wireKind: r.wireKind,
});

/** Pure projection of stored rows → inbox entries. */
export function rowsToInboxEntries(rows: readonly DmMessageRow[]): DmInboxEntry[] {
  return rows.map(rowToInboxEntry);
}

/** The inbox list: latest message per conversation for `owner`, newest-first. */
export async function loadInboxEntries(owner: string): Promise<DmInboxEntry[]> {
  return rowsToInboxEntries(await getInboxLatest(owner));
}

/** One conversation's messages, newest-first, paginated (load-older via opts). */
export async function loadConversationEntries(
  owner: string,
  partnerPubkey: string,
  opts?: { limit?: number; beforeCreatedAt?: number },
): Promise<DmInboxEntry[]> {
  return rowsToInboxEntries(await getConversationMessages(owner, partnerPubkey, opts));
}
