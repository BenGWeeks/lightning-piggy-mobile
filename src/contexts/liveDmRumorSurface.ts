import { admitOrderLifecycle, admitUnfollowedOrder, isBoundedOrderRumor } from './orderRumorIngest';
import { gateLiveDm } from './liveDmFollowGateDecision';
import { getAppFormatLocale } from '../utils/appFormatLocale';
import { dmThreadId, MARMOT_WELCOME_KIND, protocolForWireKind } from '../utils/dmProtocol';
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
import { fireMessageNotification, isThreadActivelyViewed } from '../services/notificationService';
import {
  claimWrapNotification,
  markWrapHandled,
  noteContentlessWrapAlert,
  retractContentlessWrapAlert,
  takeContentlessWrapAlert,
} from '../services/dmWrapNotificationDedupe';
import { routeMarmotWelcome } from '../services/marmotWelcomeRouter';
import type { LiveSubFollowGateBuffer } from './liveSubFollowGate';

/**
 * The live sub's post-unwrap kind-1059 surface path: Welcome → group-route →
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
  isFollowHydrated: () => boolean;
  isFollowCacheReady?: () => boolean;
  isFreshArrival: (createdAtSec: number) => boolean;
  includeNonFollowOrders?: () => boolean;
  queueInboxEntry: (entry: DmInboxEntry) => void;
  knownWrapIds: Set<string>;
  releaseWrapClaim?: (wrapId: string) => void;
  seen?: Set<string>;
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
    isFollowHydrated,
    isFollowCacheReady = () => false,
    isFreshArrival,
    includeNonFollowOrders = () => false,
    queueInboxEntry,
    knownWrapIds,
    seen,
    releaseWrapClaim = (id) => {
      knownWrapIds.delete(id);
      seen?.delete(id);
    },
    chainWrite,
  } = deps;

  return async (rumor: DecodedRumor, wrapId: string): Promise<void> => {
    if (shouldAbort()) return;
    // A contentless alert the background watch posted for this wrap (remote
    // signer, #279) is a placeholder — never deleted in the hope another alert
    // is written:
    //  - shows nothing (our own sent copy, a stranger, no partner, a group
    //    rumor we can't place): retracted;
    //  - a real message we alert for: the real alert is recorded FIRST, then
    //    the placeholder goes (the watch holds the claim, so it bypasses it);
    //  - a real message we don't alert for now (not fresh — this sub opened
    //    after it arrived): kept; its row resolves to the conversation.
    // Each decided case is also marked handled, so neither the watch nor the
    // background sync pings for it; an undecided one is left to them.
    const placeholder = takeContentlessWrapAlert(wrapId);
    const nothingToSee = () => {
      markWrapHandled(wrapId);
      if (placeholder) void retractContentlessWrapAlert(viewerPubkey, wrapId);
    };
    const alertReplacing = (threadId: string, fire: () => Promise<string | null>) => {
      markWrapHandled(wrapId);
      void Promise.resolve(fire())
        .then((id) =>
          // Replaced only if the real alert was written (or the thread is on
          // screen) — a failed post keeps the placeholder.
          placeholder && (id || isThreadActivelyViewed(threadId))
            ? retractContentlessWrapAlert(viewerPubkey, wrapId)
            : undefined,
        )
        .catch(() => undefined);
    };

    let routedWelcome: boolean;
    try {
      routedWelcome = await routeMarmotWelcome(
        rumor,
        viewerPubkey,
        wrapId,
        followPubkeysRef.current.has(rumor.pubkey?.toLowerCase() ?? ''),
        isFreshArrival(rumor.created_at),
        shouldAbort,
        placeholder,
      );
    } catch (error) {
      // Release the eager live-sub claims so another relay delivery can retry.
      releaseWrapClaim(wrapId);
      throw error;
    }
    if (routedWelcome) {
      nothingToSee();
      return;
    }

    // Group-route first — multi-recipient rumors are owned by the
    // group surface, not the 1:1 inbox. tryRouteGroupRumor handles
    // appendGroupMessage + notifyGroupMessage internally so an open
    // GroupConversationScreen auto-refreshes.
    const routeResult = await tryRouteGroupRumor(rumor, viewerPubkey, wrapId, shouldAbort, (pk) =>
      followPubkeysRef.current.has(pk),
    );
    if (shouldAbort()) return;
    if (routeResult.kind !== 'not-group') {
      // OS notification (#279) — fired HERE (live path) not inside
      // tryRouteGroupRumor (which also runs on batch refresh). Only for
      // genuinely-fresh messages (backlog has old timestamps → silent),
      // skip my own, and suppressed when the user is viewing this group.
      const routed = routeResult.kind === 'routed' ? routeResult : null;
      if (!routed || routed.message.senderPubkey.toLowerCase() === viewerPubkey.toLowerCase()) {
        nothingToSee(); // our own message, or a group rumor we can't place
      } else if (isFreshArrival(routed.message.createdAt)) {
        // claimWrapNotification: dedupe vs the background watch (#279).
        if (claimWrapNotification(wrapId) || placeholder)
          alertReplacing(routed.group.id, () =>
            fireMessageNotification({
              owner: viewerPubkey,
              kind: 'group',
              threadId: routed.group.id,
              title: routed.group.name || 'New group message',
              body: routed.message.text,
              data: {
                groupId: routed.group.id,
                messageId: routed.message.id,
                senderPubkey: routed.message.senderPubkey,
              },
            }),
          );
        else markWrapHandled(wrapId); // alerted already
      } // else: a real group message we don't alert for now — keep any placeholder
      if (__DEV__)
        console.log(`[Nostr] live wrap ${wrapId.slice(0, 8)} group-routed (${routeResult.kind})`);
      return;
    }

    const partnership = partnerFromRumor(rumor, viewerPubkey);
    if (!partnership) {
      nothingToSee();
      if (__DEV__) console.log(`[Nostr] live wrap ${wrapId.slice(0, 8)} no-partnership`);
      return;
    }

    const orderRumor = isBoundedOrderRumor(rumor);
    if (
      (rumor.kind === 16 || rumor.kind === 17) &&
      (!orderRumor ||
        !(await admitOrderLifecycle(
          viewerPubkey,
          partnership.partnerPubkey,
          partnership.fromMe,
          rumor,
        )))
    ) {
      nothingToSee();
      return;
    }
    if (shouldAbort()) return;
    const showOrderInMessages =
      followPubkeysRef.current.has(partnership.partnerPubkey) || includeNonFollowOrders();
    if (
      orderRumor &&
      !followPubkeysRef.current.has(partnership.partnerPubkey) &&
      !admitUnfollowedOrder(viewerPubkey)
    ) {
      releaseWrapClaim(wrapId);
      nothingToSee();
      return;
    }
    const decision = orderRumor
      ? 'pass'
      : gateLiveDm({
          entry: {
            id: wrapId,
            partnerPubkey: partnership.partnerPubkey,
            fromMe: partnership.fromMe,
            createdAt: rumor.created_at,
            text: textForRumor(rumor),
            wireKind: rumor.kind,
          },
          kind: 1059,
          groupRumor: routeResult.deferredGroupRumor,
          rumor,
          onEvict: () => releaseWrapClaim(wrapId),
          follows: followPubkeysRef.current,
          hydrated: isFollowHydrated(),
          cacheReady: isFollowCacheReady(),
          buffer: followGateBuffer,
          fresh: isFreshArrival(rumor.created_at),
        });
    if (decision !== 'pass') {
      if (decision === 'drop') nothingToSee();
      else if (placeholder) noteContentlessWrapAlert(wrapId);
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
      text: dmRowPreview(wrapText, rumor.kind, getAppFormatLocale()),
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
      // Conversation loaders read the store on this signal. Orders must
      // refresh an open thread even when the Messages follow gate hides them.
      if (orderRumor && !shouldAbort()) notifyDmMessage(partnership.partnerPubkey);
    });
    // Surface to the UI without awaiting the persist chain (#934 item 2) —
    // same reasoning as the kind-4 path. knownWrapIds was already
    // eagerly claimed at the top of the handler, so dedup doesn't depend
    // on the chain either.
    if (shouldAbort()) return;

    if (orderRumor && !showOrderInMessages) {
      nothingToSee();
      return;
    }
    queueInboxEntry(inboxEntry);
    if (!orderRumor) notifyDmMessage(partnership.partnerPubkey);
    // OS notification (#279) — only genuinely-fresh inbound (backlog has
    // old rumor timestamps and stays silent), never my own echo;
    // suppressed when the user is viewing this thread. claimWrapNotification
    // dedupes vs the background watch running in the same JS context. A
    // Marmot invite stays silent: its NIP-17 row is hidden (#1269).
    if (partnership.fromMe || rumor.kind === MARMOT_WELCOME_KIND) nothingToSee();
    else if (isFreshArrival(rumor.created_at)) {
      if (claimWrapNotification(wrapId) || placeholder)
        alertReplacing(dmThreadId(partnership.partnerPubkey, protocolForWireKind(rumor.kind)), () =>
          fireMessageNotification({
            owner: viewerPubkey,
            kind: 'dm',
            threadId: dmThreadId(partnership.partnerPubkey, protocolForWireKind(rumor.kind)),
            title: 'New message',
            // Use the already-redacted preview, not raw `rumor.content`: a
            // structured rumor (order JSON, or an NWC wallet-share bearer
            // connection string) must never surface its payload in a push body.
            body: inboxEntry.text,
            data: {
              conversationPubkey: partnership.partnerPubkey,
              messageId: wrapId,
              conversationProtocol: protocolForWireKind(rumor.kind),
            },
          }),
        );
      else markWrapHandled(wrapId); // alerted already
    } // else: a real message we don't alert for now (not fresh) — keep any placeholder
    if (__DEV__)
      console.log(
        `[Nostr] live wrap ${wrapId.slice(0, 8)} surfaced (partner=${partnership.partnerPubkey.slice(0, 8)})`,
      );
  };
}
