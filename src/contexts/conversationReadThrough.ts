import type { DmMessageRow } from '../services/dmDb';
import { DM_CONV_CAP, mergeConversationMessages } from './nostrDmCache';
import type { ConversationMessage } from './nostrContextTypes';

// Read-through for the conversation thread (#868). The Messages inbox preview
// is fed from the encrypted `dm_messages` table (via getInboxLatest), but the
// thread historically only painted from the per-conversation AsyncStorage cache
// blob (convCacheKey). That blob is written by a thread open / send — NOT by an
// inbox-wide refresh — so a message the inbox already ingested can be absent
// from the blob, leaving the thread emptier than the preview until a second
// relay-fetch+decrypt commits. This module reads the SAME rows the inbox holds
// (getConversationMessages) and merges them with the cache so the thread paints
// immediately and is never behind the preview. The relay fetch becomes a
// background top-up, not a precondition for showing anything.

// Map encrypted-store rows (DmMessageRow) to the thread's ConversationMessage
// shape. Pure. Used by the read-through here; nostrFetchConversation builds its
// thread slice from decrypted relay events (a different input), so it keeps its
// own projection rather than sharing this one.
export function mapStoredRowsToMessages(rows: DmMessageRow[]): ConversationMessage[] {
  return rows.map((r) => ({
    id: r.eventId,
    fromMe: r.fromMe,
    text: r.content,
    createdAt: r.createdAt,
    wireKind: r.wireKind,
  }));
}

export interface InitialConversationDeps {
  /** Per-conversation AsyncStorage cache blob (optimistic local- rows +
   * previously-merged thread). May lag the inbox for inbox-ingested messages. */
  getCachedConversation: (otherPubkey: string) => Promise<ConversationMessage[]>;
  /** The SAME encrypted-store rows the inbox preview is built from, peer-scoped.
   * Guarantees the thread can't be emptier than the inbox for ingested DMs. */
  getStoredRows: (otherPubkey: string) => Promise<DmMessageRow[]>;
}

/**
 * The instant-paint set for a thread open: the union of the per-conversation
 * cache (carries optimistic local- rows + ticks) and the ingested store rows
 * (carries everything the inbox already decrypted). Merged via
 * `mergeConversationMessages` so local- echo dedup + delivery/rumorId carry-over
 * behave exactly as the relay-fetch merge does. Reads run in parallel; a failure
 * of either source degrades to the other rather than throwing.
 */
export async function loadInitialConversation(
  otherPubkey: string,
  deps: InitialConversationDeps,
): Promise<ConversationMessage[]> {
  const [cached, rows] = await Promise.all([
    deps.getCachedConversation(otherPubkey).catch(() => [] as ConversationMessage[]),
    deps.getStoredRows(otherPubkey).catch(() => [] as DmMessageRow[]),
  ]);
  const stored = mapStoredRowsToMessages(rows);
  // Cache first so its optimistic local- rows and persisted ticks are the base;
  // stored rows merge on top (real-id echoes dedup the local- rows).
  return mergeConversationMessages(cached, stored, DM_CONV_CAP);
}
