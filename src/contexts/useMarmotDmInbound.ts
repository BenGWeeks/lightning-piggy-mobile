import { useEffect } from 'react';
import type React from 'react';

import {
  deleteMarmotMessagesBySender,
  deleteMarmotRowsOfKinds,
  getConversationMessages,
  upsertDmMessages,
  type DmMessageRow,
} from '../services/dmDb';
import { rowsToInboxEntries } from '../services/dmInbox';
import { DeletionLedger, mayDelete, parseMarmotDeletion } from '../services/marmotDeletions';
import { MARMOT_NON_MESSAGE_KINDS, marmotRumorToDmRow } from '../services/marmotInbox';
import { subscribeMarmotSession, type MarmotMessageEvent } from '../services/marmotSession';
import { dismissNotificationsFor, fireMessageNotification } from '../services/notificationService';
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
    let rows: DmMessageRow[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMessages: (() => void) | null = null;
    // "Delete for everyone" (kind 5): what has been deleted, and the removals
    // still to apply to the store. Flushes run one after another so a removal
    // always lands after the upsert of a row it targets.
    const ledger = new DeletionLedger();
    // Keyed `peer|deleter`: one store pass per pair, however many ids a replay carries.
    let removals = new Map<string, { peer: string; sender: string; ids: Set<string> }>();
    let chain: Promise<void> = Promise.resolve();

    const applyRemovals = async (batch: typeof removals) => {
      for (const { peer, sender, ids: idSet } of batch.values()) {
        const ids = [...idSet];
        try {
          await deleteMarmotMessagesBySender(pubkey, ids, sender);
          // The Messages list: drop the entry, then fall back to the thread's
          // newest remaining message so the preview never shows deleted text.
          const gone = new Set(ids);
          setDmInbox((prev) => prev.filter((e) => !(e.protocol === 'marmot' && gone.has(e.id))));
          const [latest] = await getConversationMessages(pubkey, peer, {
            limit: 1,
            protocol: 'marmot',
          });
          if (latest) {
            const [entry] = rowsToInboxEntries([latest]);
            setDmInbox((prev) =>
              prev.some((e) => e.partnerPubkey === peer && e.protocol === 'marmot')
                ? prev
                : [entry, ...prev],
            );
          }
        } catch (e) {
          if (__DEV__) console.warn('[Marmot] DM delete failed:', e);
        }
        notifyDmMessage(peer);
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
      chain = chain.then(async () => {
        if (batch.length > 0) {
          await upsertDmMessages(batch)
            .catch((e) => {
              if (__DEV__) console.warn('[Marmot] DM store write failed:', e);
            })
            .then(() => peers.forEach((peer) => notifyDmMessage(peer)));
        }
        await applyRemovals(removalBatch);
      });
      if (batch.length === 0) return;
      const entries: DmInboxEntry[] = batch.map((r) => ({
        id: r.eventId,
        partnerPubkey: r.conversation,
        fromMe: r.fromMe,
        createdAt: r.createdAt,
        text: dmRowPreview(r.content, r.wireKind),
        renderText: r.content,
        wireKind: r.wireKind,
        rumorId: r.rumorId,
        protocol: 'marmot',
      }));
      const ids = new Set(entries.map((e) => e.id));
      setDmInbox((prev) => [...entries, ...prev.filter((e) => !ids.has(e.id))]);
    };

    const onMessage = (event: MarmotMessageEvent) => {
      const deletion = parseMarmotDeletion(event.rumor, event.group);
      const peer = event.group.memberPubkeys[0];
      if (deletion && event.group.isDm && peer) {
        ledger.add(deletion, event.group.id);
        // Not yet written: drop it from the pending batch.
        rows = rows.filter(
          (r) => !(deletion.targets.includes(r.eventId) && mayDelete(deletion, r.sender)),
        );
        const key = `${peer}|${deletion.deleter}`;
        const pending = removals.get(key) ?? { peer, sender: deletion.deleter, ids: new Set() };
        deletion.targets.forEach((id) => pending.ids.add(id));
        removals.set(key, pending);
        // A notification already showing the deleted text goes too (only a
        // live deletion can have one — a replayed old one has long gone).
        if (event.rumor.created_at >= openedAtSec - NOTIFY_SKEW_SEC) {
          for (const messageId of deletion.targets) void dismissNotificationsFor({ messageId });
        }
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
        return;
      }
      const row = marmotRumorToDmRow(pubkey, event);
      if (!row) return;
      // Deleted already (the delete arrived first, or the history replays).
      if (ledger.blocks(row.eventId, row.sender, event.group.id)) return;
      rows.push(row);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
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
          },
          owner: pubkey,
        });
      }
    };

    const unsubscribeSession = subscribeMarmotSession((session) => {
      unsubscribeMessages?.();
      unsubscribeMessages =
        session && session.pubkey === pubkey ? session.subscribe({ onMessage }) : null;
    });
    return () => {
      unsubscribeSession();
      unsubscribeMessages?.();
      if (timer) clearTimeout(timer);
      flush();
    };
  }, [pubkey, setDmInbox]);
}
