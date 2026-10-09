import { useEffect } from 'react';
import type React from 'react';

import { upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import { marmotRumorToDmRow } from '../services/marmotInbox';
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
    const openedAtSec = Math.floor(Date.now() / 1000);
    let rows: DmMessageRow[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMessages: (() => void) | null = null;

    const flush = () => {
      timer = null;
      const batch = rows;
      rows = [];
      if (batch.length === 0) return;
      // An open thread re-reads the store on notify, so notify only once the
      // batch has committed (else it can re-read stale rows and miss it).
      const peers = new Set(batch.map((r) => r.conversation));
      void upsertDmMessages(batch)
        .catch((e) => {
          if (__DEV__) console.warn('[Marmot] DM store write failed:', e);
        })
        .then(() => peers.forEach((peer) => notifyDmMessage(peer)));
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
      const row = marmotRumorToDmRow(pubkey, event);
      if (!row) return;
      rows.push(row);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
      if (!row.fromMe && row.createdAt >= openedAtSec - NOTIFY_SKEW_SEC) {
        void fireMessageNotification({
          kind: 'dm',
          threadId: dmThreadId(row.conversation, 'marmot'),
          title: 'New message',
          body: dmRowPreview(row.content, row.wireKind),
          data: { conversationPubkey: row.conversation, conversationProtocol: 'marmot' },
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
