import type React from 'react';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import {
  partnerFromRumor,
  textForRumor,
  rumorEventId,
  type DecodedRumor,
} from '../utils/nip17Unwrap';
import { upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import { dmRowPreview } from '../utils/dmRowPreview';
import { notifyDmMessage } from './nostrEventBus';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { fireMessageNotification } from '../services/notificationService';
import { claimWrapNotification } from '../services/dmWrapNotificationDedupe';
import type { LiveSubFollowGateBuffer } from './liveSubFollowGate';

/**
 * The live sub's post-unwrap kind-1059 surface path: group-route →
 * partnership → follow-gate → encrypted-store persist → inbox surface →
 * OS notification. Extracted VERBATIM from `startLiveDmSubscription`'s
 * `handleInboxEvent` (Stage 2 M2, #1036) so the native relay engine — which
 * delivers already-unwrapped rumors — runs the exact same policy as the JS
 * unwrap path. No logic / ordering / guard changed in the move; every
 * comment travelled with its code.
 */
export interface LiveRumorSurfaceDeps {
  viewerPubkey: string;
  /** True once the sub was torn down (logout / account switch / relay change). */
  isCancelled: () => boolean;
  /** The live sub's mid-flight identity guard: cancelled, or the effect's
   * render snapshot no longer matches the subscription's viewer/signer. */
  shouldAbort: () => boolean;
  followPubkeysRef: React.MutableRefObject<Set<string>>;
  followGateBuffer: LiveSubFollowGateBuffer;
  isFreshArrival: (createdAtSec: number) => boolean;
  queueInboxEntry: (entry: DmInboxEntry) => void;
  knownWrapIds: Set<string>;
  /** Append a task to the sub's serialised writeChain (with its load-bearing
   * trailing catch — see the note at the call in nostrLiveDmSub). */
  chainWrite: (task: () => Promise<void>) => void;
}

export function createLiveRumorSurfacer(
  deps: LiveRumorSurfaceDeps,
): (rumor: DecodedRumor, wrapId: string) => Promise<void> {
  const {
    viewerPubkey,
    isCancelled,
    shouldAbort,
    followPubkeysRef,
    followGateBuffer,
    isFreshArrival,
    queueInboxEntry,
    knownWrapIds,
    chainWrite,
  } = deps;

  return async (rumor: DecodedRumor, wrapId: string): Promise<void> => {
    if (shouldAbort()) return;

    // Group-route first — multi-recipient rumors are owned by the
    // group surface, not the 1:1 inbox. tryRouteGroupRumor handles
    // appendGroupMessage + notifyGroupMessage internally so an open
    // GroupConversationScreen auto-refreshes.
    const routeResult = await tryRouteGroupRumor(rumor, viewerPubkey, wrapId);
    if (routeResult.kind !== 'not-group') {
      // OS notification (#279) — fired HERE (live path) not inside
      // tryRouteGroupRumor (which also runs on batch refresh). Only for
      // genuinely-fresh messages (backlog has old timestamps → silent),
      // skip my own, and suppressed when the user is viewing this group.
      if (routeResult.kind === 'routed' && isFreshArrival(routeResult.message.createdAt)) {
        const sender = routeResult.message.senderPubkey;
        // claimWrapNotification: dedupe vs the background watch (#279).
        if (sender.toLowerCase() !== viewerPubkey.toLowerCase() && claimWrapNotification(wrapId)) {
          void fireMessageNotification({
            kind: 'group',
            threadId: routeResult.group.id,
            title: routeResult.group.name || 'New group message',
            body: routeResult.message.text,
            data: { groupId: routeResult.group.id },
          });
        }
      }
      if (__DEV__)
        console.log(`[Nostr] live wrap ${wrapId.slice(0, 8)} group-routed (${routeResult.kind})`);
      return;
    }

    const partnership = partnerFromRumor(rumor, viewerPubkey);
    if (!partnership) {
      if (__DEV__) console.log(`[Nostr] live wrap ${wrapId.slice(0, 8)} no-partnership`);
      return;
    }

    // Follow gate (mirrors refreshDmInbox B1) — keeps non-followed
    // sender plaintext off AsyncStorage. Group rumors above don't
    // hit this gate because group membership is its own auth signal.
    if (!followPubkeysRef.current.has(partnership.partnerPubkey)) {
      if (__DEV__)
        console.log(
          `[Nostr] live wrap ${wrapId.slice(0, 8)} dropped by follow-gate (partner=${partnership.partnerPubkey.slice(0, 8)})`,
        );
      // Defer fresh inbound for replay once follows hydrate (#851 F2). Skip my
      // own echoes and historical backlog (silent); persistence is left to the
      // next refreshDmInbox — see replayDeferredFollowGate.
      if (!partnership.fromMe && isFreshArrival(rumor.created_at)) {
        // For a structured rumor (order kind 16/17, or an NWC wallet share)
        // `textForRumor` returns non-human JSON; surface a readable, SECRET-FREE
        // preview so a raw blob (or, for a share, a bearer connection string)
        // never leaks into the conversation list OR the notification body when
        // the sender isn't followed (mirrors the non-deferred path below). Plain
        // DM rumors pass through unchanged.
        const deferredText = dmRowPreview(textForRumor(rumor), rumor.kind);
        followGateBuffer.defer({
          partnerPubkey: partnership.partnerPubkey,
          entry: {
            id: wrapId,
            partnerPubkey: partnership.partnerPubkey,
            fromMe: partnership.fromMe,
            createdAt: rumor.created_at,
            text: deferredText,
            wireKind: rumor.kind,
          },
          notify: { title: 'New message', body: deferredText },
        });
      }
      return;
    }

    const wrapText = textForRumor(rumor);
    const wrapRow: DmMessageRow = {
      owner: viewerPubkey,
      eventId: wrapId,
      conversation: partnership.partnerPubkey,
      createdAt: rumor.created_at,
      sender: partnership.fromMe ? viewerPubkey : partnership.partnerPubkey,
      content: wrapText,
      fromMe: partnership.fromMe,
      wireKind: rumor.kind,
    };
    const inboxEntry: DmInboxEntry = {
      id: wrapId,
      partnerPubkey: partnership.partnerPubkey,
      fromMe: partnership.fromMe,
      createdAt: rumor.created_at,
      // For a structured rumor (order kind 16/17, or an NWC wallet share)
      // `wrapText` is non-human JSON; surface a readable, secret-free preview.
      // Plain DM rumors pass through unchanged.
      text: dmRowPreview(wrapText, rumor.kind),
      wireKind: rumor.kind,
      // Inner rumor id (#857) — the delivery-store key for our own sent rows,
      // stable across the optimistic bubble + this live echo.
      rumorId: partnership.fromMe ? rumorEventId(rumor) : undefined,
    };

    // Serialise store upserts so concurrent live wraps don't race each other.
    chainWrite(async () => {
      if (isCancelled()) return;
      // Encrypted store write (#848) — idempotent by (owner, event_id), so
      // a wrap delivered by both the live sub and a near-simultaneous
      // refresh lands as one row (the old file read→merge→write dance and
      // its #811 clobbering hazard are gone). The store is the ONLY
      // at-rest persistence (#850) — the plaintext inbox blob is retired.
      await upsertDmMessages([wrapRow]);
      knownWrapIds.add(wrapId);
    });
    // Surface to the UI without awaiting the persist chain (#934 item 2) —
    // same reasoning as the kind-4 path. knownWrapIds was already
    // eagerly claimed at the top of the handler, so dedup doesn't depend
    // on the chain either.
    if (shouldAbort()) return;

    queueInboxEntry(inboxEntry);
    notifyDmMessage(partnership.partnerPubkey);
    // OS notification (#279) — only genuinely-fresh inbound (backlog has
    // old rumor timestamps and stays silent), never my own echo;
    // suppressed when the user is viewing this thread. claimWrapNotification
    // dedupes vs the background watch running in the same JS context.
    if (!partnership.fromMe && isFreshArrival(rumor.created_at) && claimWrapNotification(wrapId)) {
      void fireMessageNotification({
        kind: 'dm',
        threadId: partnership.partnerPubkey,
        title: 'New message',
        // Use the already-redacted preview, not raw `rumor.content`: a
        // structured rumor (order JSON, or an NWC wallet-share bearer
        // connection string) must never surface its payload in a push body.
        body: inboxEntry.text,
        data: { conversationPubkey: partnership.partnerPubkey },
      });
    }
    if (__DEV__)
      console.log(
        `[Nostr] live wrap ${wrapId.slice(0, 8)} surfaced (partner=${partnership.partnerPubkey.slice(0, 8)})`,
      );
  };
}
