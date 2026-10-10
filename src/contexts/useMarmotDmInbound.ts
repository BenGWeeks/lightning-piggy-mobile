import { useEffect } from 'react';
import type React from 'react';

import {
  deleteMarmotMessages,
  deleteMarmotRowsOfKinds,
  getConversationMessages,
  upsertDmMessages,
  type DmMessageRow,
} from '../services/dmDb';
import { rowsToInboxEntries } from '../services/dmInbox';
import { mayDelete, parseMarmotDeletion } from '../services/marmotDeletions';
import { MarmotDeletionTracker } from '../services/marmotDeletionTracker';
import { MARMOT_NON_MESSAGE_KINDS, marmotRumorToDmRow } from '../services/marmotInbox';
import { subscribeMarmotSession, type MarmotMessageEvent } from '../services/marmotSession';
import { fireMessageNotification } from '../services/notificationService';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { dmThreadId } from '../utils/dmProtocol';
import { dmRowPreview } from '../utils/dmRowPreview';
import { notifyDmMessage } from './nostrEventBus';

const FLUSH_MS = 150;
const NOTIFY_SKEW_SEC = 120;

/**
 * Route decrypted Marmot DM-group messages into the encrypted DM store and the
 * Messages list, mirroring the NIP-17 live path (store → inbox → OS alert).
 * Rows/entries are coalesced into one write + one setState per ≤150 ms burst
 * (#perf: never setState per emitter event). Multi-member groups are handled
 * by GroupsContext, not here.
 */
export function useMarmotDmInbound(
  pubkey: string | null,
  setDmInbox: React.Dispatch<React.SetStateAction<DmInboxEntry[]>>,
): void {
  useEffect(() => {
    if (!pubkey) return;
    // Builds before the filter stored push-token / reaction events as rows.
    void deleteMarmotRowsOfKinds(pubkey, MARMOT_NON_MESSAGE_KINDS).catch(() => undefined);
    const openedAtSec = Math.floor(Date.now() / 1000);
    let disposed = false;
    let rows: DmMessageRow[] = [];
    const groupsByMessage = new WeakMap<DmMessageRow, string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMessages: (() => void) | null = null;
    // "Delete for everyone" (kind 5 / admin 4891): what has been deleted, and
    // the removals still to apply to the store. Flushes run one after another
    // so a removal always lands after the upsert of a row it targets.
    const deletions = new MarmotDeletionTracker(pubkey, openedAtSec);
    // Keyed `group|peer|deleter`: one store pass per pair, however many ids a replay carries.
    let removals = new Map<string, { peer: string; sender: string | null; ids: Set<string> }>();
    let chain: Promise<void> = Promise.resolve();

    const applyRemovals = async (batch: typeof removals) => {
      for (const { peer, sender, ids: idSet } of batch.values()) {
        const ids = [...idSet];
        try {
          const deleted = await deleteMarmotMessages(pubkey, peer, ids, sender);
          // Nothing stored matched (a replayed delete, a reaction retraction):
          // no preview to fix, no thread to reload.
          if (deleted.length === 0) continue;
          const [latest] = await getConversationMessages(pubkey, peer, {
            limit: 1,
            protocol: 'marmot',
          });
          if (disposed) continue;
          const gone = new Set(deleted);
          const entry = latest ? rowsToInboxEntries([latest])[0] : undefined;
          setDmInbox((prev) => {
            if (disposed) return prev;
            const remaining = prev.filter(
              (e) =>
                !(
                  e.protocol === 'marmot' &&
                  e.partnerPubkey === peer &&
                  (gone.has(e.id) || (entry && e.createdAt <= entry.createdAt))
                ),
            );
            return entry
              ? [
                  entry,
                  ...remaining.filter(
                    (e) =>
                      !(e.protocol === 'marmot' && e.partnerPubkey === peer && e.id === entry.id),
                  ),
                ]
              : remaining;
          });
          if (!disposed) notifyDmMessage(peer);
        } catch (e) {
          if (__DEV__) console.warn('[Marmot] DM delete failed:', e);
        }
      }
    };

    const flush = () => {
      timer = null;
      const batch = rows;
      rows = [];
      const removalBatch = removals;
      removals = new Map();
      if (batch.length === 0 && removalBatch.size === 0) return;
      // An open thread re-reads the store on notify, so notify only once the
      // batch has committed (else it can re-read stale rows and miss it).
      const peers = new Set(batch.map((r) => r.conversation));
      chain = chain
        .then(async () => {
          try {
            // Durable before rows are tested: cache eviction must never erase a
            // queued deletion or let a later replay through.
            await deletions.persist();
            const accepted = await deletions.filterLive(batch, (row) => ({
              scope: groupsByMessage.get(row)!,
              id: row.eventId,
              sender: row.sender,
            }));
            if (accepted.length) await upsertDmMessages(accepted);
            if (!disposed) {
              const entries = rowsToInboxEntries(accepted);
              const ids = new Set(entries.map((e) => e.id));
              if (entries.length)
                setDmInbox((prev) =>
                  disposed ? prev : [...entries, ...prev.filter((e) => !ids.has(e.id))],
                );
              peers.forEach((peer) => notifyDmMessage(peer));
              for (const row of accepted) notifyMessage(row, groupsByMessage.get(row)!);
            }
          } catch (e) {
            if (__DEV__) console.warn('[Marmot] DM batch failed:', e);
          }
          // Even when the upsert failed: stored copies must still go.
          await applyRemovals(removalBatch);
        })
        .catch((e) => {
          if (__DEV__) console.warn('[Marmot] DM removal failed:', e);
        });
    };

    const onMessage = (event: MarmotMessageEvent) => {
      const deletion = parseMarmotDeletion(event.rumor, event.group);
      const peer = event.group.memberPubkeys[0];
      if (deletion && event.group.isDm && peer) {
        deletions.note(event.group.id, deletion, event.rumor.created_at);
        // Not yet written: drop it from the pending batch.
        rows = rows.filter(
          (r) =>
            !(
              r.conversation === peer &&
              deletion.targets.includes(r.eventId) &&
              mayDelete(deletion, r.sender)
            ),
        );
        // An admin removal may take either member's message; else only the deleter's own.
        const sender = deletion.anyAuthor ? null : deletion.deleter;
        const key = `${event.group.id}|${peer}|${sender}`;
        const pending = removals.get(key) ?? { peer, sender, ids: new Set() };
        deletion.targets.forEach((id) => pending.ids.add(id));
        removals.set(key, pending);
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
        return;
      }
      const row = marmotRumorToDmRow(pubkey, event);
      if (!row) return;
      // Deleted already (the delete arrived first, or the history replays).
      if (deletions.blocks(event.group.id, row.eventId, row.sender)) return;
      groupsByMessage.set(row, event.group.id);
      rows.push(row);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };

    const notifyMessage = (row: DmMessageRow, groupId: string) => {
      if (!row.fromMe && row.createdAt >= openedAtSec - NOTIFY_SKEW_SEC) {
        void fireMessageNotification({
          kind: 'dm',
          threadId: dmThreadId(row.conversation, 'marmot'),
          title: 'New message',
          body: dmRowPreview(row.content, row.wireKind),
          data: {
            conversationPubkey: row.conversation,
            conversationProtocol: 'marmot',
            messageId: row.eventId,
            marmotGroupId: groupId,
            senderPubkey: row.sender,
          },
          owner: pubkey,
          shouldSuppress: async () =>
            disposed || (await deletions.isDeleted(groupId, row.eventId, row.sender)),
        });
      }
    };

    const unsubscribeSession = subscribeMarmotSession((session) => {
      unsubscribeMessages?.();
      unsubscribeMessages =
        session && session.pubkey === pubkey ? session.subscribe({ onMessage }) : null;
    });
    return () => {
      disposed = true;
      unsubscribeSession();
      unsubscribeMessages?.();
      if (timer) clearTimeout(timer);
      flush();
      deletions.dispose();
    };
  }, [pubkey, setDmInbox]);
}
