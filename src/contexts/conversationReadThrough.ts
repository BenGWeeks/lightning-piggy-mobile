import type { DmMessageRow } from '../services/dmDb';
import { DM_CONV_CAP, dedupeLocalEchoes } from './nostrDmCache';
import type { ConversationMessage } from './nostrContextTypes';

// Read-through for the conversation thread (#868, single-sourced in #850).
// The Messages inbox preview and the thread both read the SAME encrypted
// `dm_messages` rows (getInboxLatest / getConversationMessages), so the
// thread paints immediately and can never be behind the preview. The
// per-conversation plaintext AsyncStorage blob this used to union in is
// retired (#850): optimistic local- rows, delivery ticks (#856) and rumor
// ids (#857) now live on the encrypted rows themselves, so one store read
// carries everything. The relay fetch stays a background top-up, not a
// precondition for showing anything.

// Map encrypted-store rows (DmMessageRow) to the thread's ConversationMessage
// shape, carrying the delivery tick + rumorId columns (#850). Pure.
export function mapStoredRowsToMessages(rows: DmMessageRow[]): ConversationMessage[] {
  return rows.map((r) => ({
    id: r.eventId,
    fromMe: r.fromMe,
    text: r.content,
    createdAt: r.createdAt,
    wireKind: r.wireKind,
    ...(r.deliveryStatus !== undefined ? { deliveryStatus: r.deliveryStatus } : {}),
    ...(r.rumorId !== undefined ? { rumorId: r.rumorId } : {}),
  }));
}

export interface InitialConversationDeps {
  /** This thread's slice of the encrypted store — the same rows the inbox
   * preview is built from, peer-scoped. The only at-rest source (#850). */
  getStoredRows: (otherPubkey: string) => Promise<DmMessageRow[]>;
}

/**
 * The instant-paint set for a thread open: the encrypted store's slice for
 * this peer, oldest-first, with any raced local-echo pair collapsed to one
 * bubble (`dedupeLocalEchoes` — the store-level retire in upsertDmMessages
 * usually already did this; the read-side pass covers the append/echo race).
 * A store failure degrades to an empty paint rather than throwing.
 */
export async function loadInitialConversation(
  otherPubkey: string,
  deps: InitialConversationDeps,
): Promise<ConversationMessage[]> {
  const rows = await deps.getStoredRows(otherPubkey).catch(() => [] as DmMessageRow[]);
  return dedupeLocalEchoes(mapStoredRowsToMessages(rows), DM_CONV_CAP);
}
