import { getInboxLatest, getConversationMessages, type DmMessageRow } from './dmDb';
import type { DmInboxEntry } from '../utils/conversationSummaries';

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
  text: r.content,
  wireKind: r.wireKind,
});

/** Pure projection of stored rows → inbox entries. */
export function rowsToInboxEntries(rows: readonly DmMessageRow[]): DmInboxEntry[] {
  return rows.map(rowToInboxEntry);
}

/** The inbox list: latest message per conversation, newest-first. */
export async function loadInboxEntries(): Promise<DmInboxEntry[]> {
  return rowsToInboxEntries(await getInboxLatest());
}

/** One conversation's messages, newest-first, paginated (load-older via opts). */
export async function loadConversationEntries(
  partnerPubkey: string,
  opts?: { limit?: number; beforeCreatedAt?: number },
): Promise<DmInboxEntry[]> {
  return rowsToInboxEntries(await getConversationMessages(partnerPubkey, opts));
}
