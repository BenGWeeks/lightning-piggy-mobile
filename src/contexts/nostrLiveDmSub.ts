import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { SignerType } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import {
  partnerFromRumor,
  unwrapWrapNsec,
  unwrapWrapViaNip44,
  textForRumor,
  rumorEventId,
  type DecodedRumor,
} from '../utils/nip17Unwrap';
import { listPersistedGroupWrapIds } from '../services/groupMessagesStorageService';
import { selectDmWrapIds, upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import {
  parseOrderEvent,
  serializeOrder,
  orderPreviewText,
  orderPreviewFromContent,
} from '../utils/orderEvents';
import { nip04PlaintextCache, getMemoisedSecretKey } from './nostrSecretKeyCache';
import { notifyDmMessage } from './nostrEventBus';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { fireMessageNotification } from '../services/notificationService';
import { subscribeInboxDmsForViewer } from '../services/dmLiveSubscription';
import { yieldToEventLoop } from './nostrDecryptPacing';
import { capKnownWrapIds } from './knownWrapIdsCap';
import type { LiveSubFollowGateBuffer, DeferredFollowGateEntry } from './liveSubFollowGate';
import {
  COLD_INITIAL_WRAP_LIMIT,
  DM_INBOX_CAP,
  inboxCacheKey,
  inboxLastSeenKey,
  safeGetDmCacheItem,
  loadLastSeen,
  mergeInboxEntries,
} from './nostrDmCache';
import { ensureDmStoreMigrated } from './dmStoreMigrationRunner';

/**
 * Snapshot + live-dependency bundle the live-DM subscription closes over.
 *
 * `viewerPubkey` / `activeSigner` are the effect-instance snapshots (the
 * `pubkey` / `signerType` captured at the moment the subscription opened).
 * `pubkey` / `signerType` are the same render-snapshot the inline
 * `useEffect` closed over — the mid-flight identity guards inside the
 * handler compare `viewerPubkey !== pubkey` / `activeSigner !== signerType`
 * against them exactly as before. Within one effect instance these never
 * change (React captures the render's values), so the guards evaluate
 * identically to the pre-extraction version. `followPubkeysRef`,
 * `knownWrapIdsRef`, and the two setters are stable across re-renders, so
 * reading them through the bundle keeps the gate + dedup behaviour
 * byte-for-byte identical.
 */
export interface LiveDmSubscriptionParams {
  viewerPubkey: string;
  activeSigner: SignerType;
  pubkey: string | null;
  signerType: SignerType | null;
  readRelays: string[];
  knownWrapIdsRef: React.MutableRefObject<{ pubkey: string | null; set: Set<string> }>;
  followPubkeysRef: React.MutableRefObject<Set<string>>;
  setDmInbox: React.Dispatch<React.SetStateAction<DmInboxEntry[]>>;
  setAmberNip44Permission: React.Dispatch<React.SetStateAction<'unknown' | 'granted' | 'denied'>>;
  // Follow-gate deferral buffer (#851 F2). Fresh inbound dropped while the
  // post-switch follows list is still hydrating is buffered here; the hook
  // calls `replayDeferredFollowGate` (registered via `setDeferredReplay`)
  // when follows update, re-surfacing + re-notifying entries that now pass.
  followGateBuffer: LiveSubFollowGateBuffer;
  setDeferredReplay: (fn: ((item: DeferredFollowGateEntry) => void) | null) => void;
}

/**
 * Open the long-lived kind-1059 (NIP-17 gift wrap) + kind-4 (NIP-04)
 * subscription for the current viewer (#349) and return the teardown
 * function. Extracted verbatim from `useDmInbox`'s live-sub `useEffect`
 * body (#703) — the hook calls this from the effect and returns the
 * result as its cleanup. No logic / ordering / guard changed.
 */
export function startLiveDmSubscription(params: LiveDmSubscriptionParams): () => void {
  const {
    viewerPubkey,
    activeSigner,
    pubkey,
    signerType,
    readRelays,
    knownWrapIdsRef,
    followPubkeysRef,
    setDmInbox,
    setAmberNip44Permission,
    followGateBuffer,
    setDeferredReplay,
  } = params;
  const seen = new Set<string>();
  const SEEN_CAP = 4096;
  // In-memory mirror of the encrypted DM store's wrap-id index
  // (#848). Backed by `knownWrapIdsRef` so the Set survives this
  // effect's re-runs (relay-list change → fresh effect instance).
  // Seeded by union below from the store + persisted group wrap ids,
  // but does NOT replace any entries the prior sub instance added
  // in-memory but the deferred
  // writeChain hasn't persisted yet. Per issue #505 — the relay
  // re-streams the backlog since the last `since` cursor, and on a
  // busy account that's 100+ wraps in ~12 s, almost all of which are
  // already known; pre-#505 the dedup-cache hit check was
  // lazy-populated and downstream of several per-event operations.
  if (knownWrapIdsRef.current.pubkey !== viewerPubkey) {
    knownWrapIdsRef.current = { pubkey: viewerPubkey, set: new Set() };
  }
  const knownWrapIds: Set<string> = knownWrapIdsRef.current.set;
  let cancelled = false;
  let writeChain: Promise<void> = Promise.resolve();
  // Wall-clock second the sub opened. We fire OS notifications ONLY for
  // messages whose own timestamp is at/after this (minus a clock-skew
  // buffer) — i.e. genuinely-new arrivals, never the historical backlog
  // the relay replays on open (a fresh login otherwise floods to Android's
  // 50-cap, #279). We can't use EOSE for this: nostr-tools fires `oneose`
  // on an ~2 s eoseTimeout, which lands mid-backlog for a large history and
  // wrongly marks the rest "live". The message timestamp is reliable —
  // NIP-17 randomises only the gift-WRAP time; the inner kind-14 rumor's
  // `created_at` (and kind-4's) is the real send time.
  const subOpenedAtSec = Math.floor(Date.now() / 1000);
  const NOTIFY_SKEW_SEC = 120; // tolerate sender/receiver clock drift
  const isFreshArrival = (createdAtSec: number): boolean =>
    createdAtSec >= subOpenedAtSec - NOTIFY_SKEW_SEC;

  // Coalesce per-event inbox merges into one setDmInbox call per ~150 ms or per 25 events. Without this, a relay-restream burst (e.g. cold start with 200+ kind-4 events queued) causes one React re-render per event = 30+ rerenders/sec on the JS thread, which is what locks the UI for 30 seconds. Batching collapses that into ~6 rerenders/sec at most. Notifications still fire per-event so unread counts/sounds aren't dropped.
  let pendingInboxEntries: DmInboxEntry[] = [];
  let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const PENDING_FLUSH_MS = 150;
  const PENDING_FLUSH_THRESHOLD = 25;
  const flushPendingInbox = (): void => {
    if (pendingFlushTimer) {
      clearTimeout(pendingFlushTimer);
      pendingFlushTimer = null;
    }
    if (pendingInboxEntries.length === 0) return;
    const batch = pendingInboxEntries;
    pendingInboxEntries = [];
    setDmInbox((prev) => mergeInboxEntries(prev, batch, DM_INBOX_CAP));
  };
  const queueInboxEntry = (entry: DmInboxEntry): void => {
    pendingInboxEntries.push(entry);
    if (pendingInboxEntries.length >= PENDING_FLUSH_THRESHOLD) {
      flushPendingInbox();
      return;
    }
    if (pendingFlushTimer === null) {
      pendingFlushTimer = setTimeout(flushPendingInbox, PENDING_FLUSH_MS);
    }
  };

  // Replay the surface + notify side-effects of a fresh inbound that was
  // deferred by the follow-gate during the post-switch hydration window
  // (#851 F2). Called by the hook (via the registered ref) once follows
  // hydrate and the buffered partner is confirmed followed — so we re-run
  // the SAME surface path the original drop skipped. Persistence is left to
  // the next refreshDmInbox (the drop was never skip-set-persisted), so this
  // only recovers the live inbox update + the one-shot OS notification.
  const replayDeferredFollowGate = (item: DeferredFollowGateEntry): void => {
    if (cancelled) return;
    queueInboxEntry(item.entry);
    notifyDmMessage(item.partnerPubkey);
    if (item.notify) {
      void fireMessageNotification({
        kind: 'dm',
        threadId: item.partnerPubkey,
        title: item.notify.title,
        body: item.notify.body,
        data: { conversationPubkey: item.partnerPubkey },
      });
    }
  };
  setDeferredReplay(replayDeferredFollowGate);

  const handleInboxEvent = async (ev: nostrService.RawInboxDmEvent): Promise<void> => {
    // Earliest-possible short-circuit for NIP-17 wraps we already
    // decrypted on a previous launch. Cost saved per backlog wrap:
    // console.log + seen.has + seen.add + kind dispatch + cacheKey
    // build + the async AsyncStorage.getItem race. On a busy
    // fixture with 100+ wraps in the backlog this compressed the
    // cold-start JS-thread occupation window from ~12 s to <1 s.
    // Per issue #505.
    if (ev.kind === 1059 && knownWrapIds.has(ev.id)) return;
    // Eagerly claim this wrap.id in the in-memory dedup Set before
    // doing any async work. The deferred writeChain at the bottom of
    // this handler also does this, but only after AsyncStorage I/O
    // completes — leaving a window where a re-opened sub (relay-list
    // change mid cold start) re-streams the same wrap and gets past
    // the early-return because the Set hasn't been updated yet.
    // Set.add is idempotent so the trailing writeChain add becomes
    // a no-op. kind 4 has its own `seen` Set below.
    if (ev.kind === 1059) {
      knownWrapIds.add(ev.id);
      capKnownWrapIds(knownWrapIds);
    }
    if (__DEV__) console.log(`[Nostr] live evt kind=${ev.kind} recv ${ev.id.slice(0, 8)}`);
    if (cancelled) return;
    if (seen.has(ev.id)) {
      if (__DEV__) console.log(`[Nostr] live evt ${ev.id.slice(0, 8)} dedup-seen`);
      return;
    }
    seen.add(ev.id);
    // Drop oldest ~25% so a long-lived sub under spam doesn't grow the Set unboundedly.
    if (seen.size > SEEN_CAP) {
      const drop = Math.floor(SEEN_CAP / 4);
      const it = seen.values();
      for (let i = 0; i < drop; i++) seen.delete(it.next().value!);
    }

    // NIP-04 (kind-4) — partner is in the envelope; decrypt directly with the active signer.
    if (ev.kind === 4) {
      const fromMe = ev.pubkey === viewerPubkey;
      const recipientTag = ev.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase();
      const partnerPubkey = fromMe ? recipientTag : ev.pubkey.toLowerCase();
      if (!partnerPubkey || !/^[0-9a-f]{64}$/.test(partnerPubkey)) {
        if (__DEV__) console.log(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} no-partner`);
        return;
      }
      let plaintext = nip04PlaintextCache.get(ev.id);
      if (plaintext === undefined) {
        try {
          if (activeSigner === 'nsec') {
            const secretKey = await getMemoisedSecretKey(viewerPubkey);
            if (!secretKey) return;
            plaintext = await nostrService.decryptNip04WithSecret(
              secretKey,
              partnerPubkey,
              ev.content,
            );
          } else if (activeSigner === 'amber') {
            plaintext = await amberService.requestNip04Decrypt(
              ev.content,
              partnerPubkey,
              viewerPubkey,
            );
          } else {
            return;
          }
        } catch (error) {
          if (__DEV__)
            console.warn(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} decrypt failed:`, error);
          return;
        }
        if (!plaintext) {
          if (__DEV__) console.log(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} empty-plaintext`);
          return;
        }
        nip04PlaintextCache.set(ev.id, plaintext);
      } else if (__DEV__) {
        console.log(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} dedup-cache`);
      }
      if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

      // Follow gate (mirrors refreshDmInbox B1) — incoming kind-4 from a non-followed sender is dropped from inbox state. Outgoing (fromMe) bypasses since we sent it.
      if (!fromMe && !followPubkeysRef.current.has(partnerPubkey)) {
        if (__DEV__)
          console.log(
            `[Nostr] live kind-4 ${ev.id.slice(0, 8)} dropped by follow-gate (partner=${partnerPubkey.slice(0, 8)})`,
          );
        // Defer fresh inbound for replay once follows hydrate (#851 F2). Only
        // genuinely-fresh arrivals carry a notification; older backlog stays
        // silent. Persistence is intentionally skipped — see replay helper.
        if (isFreshArrival(ev.created_at)) {
          followGateBuffer.defer({
            partnerPubkey,
            entry: {
              id: ev.id,
              partnerPubkey,
              fromMe,
              createdAt: ev.created_at,
              text: plaintext,
              wireKind: 4,
            },
            notify: { title: 'New message', body: plaintext },
          });
        }
        return;
      }

      const k4InboxEntry: DmInboxEntry = {
        id: ev.id,
        partnerPubkey,
        fromMe,
        createdAt: ev.created_at,
        text: plaintext,
        wireKind: 4,
      };
      // Persist the decrypted kind-4 to the encrypted store (#848 — the RAM
      // LRU dies with the session) plus the inbox preview blob. Same
      // writeChain as kind-1059 to serialize concurrent inbox writes. Also
      // bump inboxLastSeenKey so refreshDmInbox's kind-4 `since` filter
      // advances and doesn't re-fetch already-seen events on the next refresh.
      const k4Row: DmMessageRow = {
        owner: viewerPubkey,
        eventId: ev.id,
        conversation: partnerPubkey,
        createdAt: ev.created_at,
        sender: fromMe ? viewerPubkey : partnerPubkey,
        content: plaintext,
        fromMe,
        wireKind: 4,
      };
      writeChain = writeChain
        .then(async () => {
          if (cancelled) return;
          await upsertDmMessages([k4Row]).catch((e) => {
            if (__DEV__) console.warn('[DmStore] live kind-4 upsert failed:', e);
          });
          const inboxRaw = await safeGetDmCacheItem(inboxCacheKey(viewerPubkey));
          const cachedInbox: DmInboxEntry[] = inboxRaw
            ? (() => {
                try {
                  const parsed = JSON.parse(inboxRaw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          const merged = mergeInboxEntries(cachedInbox, [k4InboxEntry], DM_INBOX_CAP);
          // Re-check after the await: logout may have multiRemove'd these keys while we were reading. Without this, a freshly-decrypted DM would re-populate disk after the user signed out.
          if (cancelled) return;
          await AsyncStorage.setItem(inboxCacheKey(viewerPubkey), JSON.stringify(merged)).catch(
            () => {},
          );
          const lastSeenRaw = await AsyncStorage.getItem(inboxLastSeenKey(viewerPubkey));
          const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : 0;
          if (ev.created_at > lastSeen) {
            if (cancelled) return;
            await AsyncStorage.setItem(inboxLastSeenKey(viewerPubkey), String(ev.created_at)).catch(
              () => {},
            );
          }
        })
        .catch((e) => {
          if (__DEV__) console.warn('[Nostr] live kind-4 persist failed:', e);
        });
      await writeChain;
      if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

      queueInboxEntry(k4InboxEntry);
      notifyDmMessage(partnerPubkey);
      // OS notification (#279) — only genuinely-fresh inbound (the
      // historical backlog the relay replays on open has old timestamps
      // and stays silent), never my own echo; suppressed by
      // notificationService when the user is viewing this exact thread.
      if (!fromMe && isFreshArrival(ev.created_at)) {
        void fireMessageNotification({
          kind: 'dm',
          threadId: partnerPubkey,
          title: 'New message',
          body: plaintext,
          data: { conversationPubkey: partnerPubkey },
        });
      }
      if (__DEV__)
        console.log(
          `[Nostr] live kind-4 ${ev.id.slice(0, 8)} surfaced (partner=${partnerPubkey.slice(0, 8)}, fromMe=${fromMe})`,
        );
      return;
    }

    // Marketplace order / receipt (kind-16 / kind-17) — PLAINTEXT events a
    // Plebeian/Gamma-style market addresses to the buyer via a `#p` tag (#market).
    // No decryption: `parseOrderEvent` both classifies the event and rejects
    // NIP-18 reposts that share kind 16. These bypass the follow-gate — the
    // user transacted with the market even though they don't "follow" it — and
    // are stored with `wireKind` 16/17 so the conversation renderer shows an
    // order card and the inbox derives a readable preview.
    if (ev.kind === 16 || ev.kind === 17) {
      const order = parseOrderEvent(ev);
      if (!order) {
        if (__DEV__) console.log(`[Nostr] live kind-${ev.kind} ${ev.id.slice(0, 8)} not-an-order`);
        return;
      }
      const fromMe = ev.pubkey === viewerPubkey;
      const recipientTag = ev.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase();
      const partnerPubkey = fromMe ? recipientTag : ev.pubkey.toLowerCase();
      if (!partnerPubkey || !/^[0-9a-f]{64}$/.test(partnerPubkey)) {
        if (__DEV__) console.log(`[Nostr] live kind-${ev.kind} ${ev.id.slice(0, 8)} no-partner`);
        return;
      }
      const serialized = serializeOrder(order);
      const preview = orderPreviewText(order);
      const orderRow: DmMessageRow = {
        owner: viewerPubkey,
        eventId: ev.id,
        conversation: partnerPubkey,
        createdAt: ev.created_at,
        sender: fromMe ? viewerPubkey : partnerPubkey,
        content: serialized,
        fromMe,
        wireKind: ev.kind,
      };
      const orderInboxEntry: DmInboxEntry = {
        id: ev.id,
        partnerPubkey,
        fromMe,
        createdAt: ev.created_at,
        text: preview,
        wireKind: ev.kind,
      };
      // Anti-spam gate for the OS notification (Copilot #927). Orders bypass
      // the follow-gate for STORAGE (a buyer transacted with the market even
      // though they don't follow it), but the events are PLAINTEXT and addressed
      // by `#p`, so any sender can craft an order-shaped kind-16/17 to the
      // viewer. To avoid OS-level notification spam, only raise a push when the
      // market is already trusted: followed, OR an existing conversation in the
      // inbox cache. Unknown senders are still stored + surfaced in-app silently.
      // (Follow-up: record markets the user actively ordered from — e.g. via the
      // Explore Market checkout — into a trust set so a first legitimate order
      // notifies too.) `partnerKnown` is read from the inbox BEFORE this event
      // merges in, so the very first order from a stranger can't self-qualify.
      const partnerFollowed = followPubkeysRef.current.has(partnerPubkey);
      let partnerKnown = partnerFollowed;
      writeChain = writeChain
        .then(async () => {
          if (cancelled) return;
          await upsertDmMessages([orderRow]).catch((e) => {
            if (__DEV__) console.warn('[DmStore] live order upsert failed:', e);
          });
          const inboxRaw = await safeGetDmCacheItem(inboxCacheKey(viewerPubkey));
          const cachedInbox: DmInboxEntry[] = inboxRaw
            ? (() => {
                try {
                  const parsed = JSON.parse(inboxRaw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          if (cachedInbox.some((e) => e.partnerPubkey === partnerPubkey)) partnerKnown = true;
          const merged = mergeInboxEntries(cachedInbox, [orderInboxEntry], DM_INBOX_CAP);
          if (cancelled) return;
          await AsyncStorage.setItem(inboxCacheKey(viewerPubkey), JSON.stringify(merged)).catch(
            () => {},
          );
        })
        .catch((e) => {
          if (__DEV__) console.warn('[Nostr] live order persist failed:', e);
        });
      await writeChain;
      if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

      queueInboxEntry(orderInboxEntry);
      notifyDmMessage(partnerPubkey);
      if (!fromMe && isFreshArrival(ev.created_at) && partnerKnown) {
        void fireMessageNotification({
          kind: 'dm',
          threadId: partnerPubkey,
          title: 'Marketplace update',
          body: preview,
          data: { conversationPubkey: partnerPubkey },
        });
      }
      if (__DEV__)
        console.log(
          `[Nostr] live kind-${ev.kind} ${ev.id.slice(0, 8)} surfaced (order=${order.orderId.slice(0, 8)}, partner=${partnerPubkey.slice(0, 8)})`,
        );
      return;
    }

    // NIP-17 (kind-1059) — existing gift-wrap unwrap path. Local alias preserves original variable name without renaming through the body below.
    const wrap = ev;

    // knownWrapIds is seeded eagerly up-front below (before the
    // subscription opens) — the in-flow lazy-load was removed in
    // #505 because it (a) raced when many wraps arrived together
    // and each tried to seed the Set concurrently, and (b) made
    // dedup hits pay through a long per-event prologue before the
    // check fired. The check for known IDs lives at the very top of
    // this function for kind-1059 events. This point is only reached
    // for genuinely new (not-yet-stored) wraps, OR — in the rare
    // case the seed failed (see the catch in the sub-open block) —
    // for wraps that should have been pre-known. In that case the
    // wrap re-decrypts; the encrypted-store upsert below is
    // idempotent by (owner, event_id), but the `dmMessageListeners`
    // may fire a second time for messages already shown in a
    // previous session. Acceptable trade-off because the seed only
    // fails on DB I/O error which is extremely rare.

    const onSkip = (reason: string, wrapId: string) => {
      if (__DEV__) console.warn(`[Nostr] live NIP-17 unwrap skip (${wrapId}): ${reason}`);
    };

    // Yield to the event loop before each per-wrap decryption. The
    // live sub fans out wraps from the relay one at a time, but
    // when the sub catches up a backlog after cold start, multiple
    // wraps land in the same JS task — each sync `unwrapWrapNsec`
    // is ~1-3 ms and they pile up to tens-of-ms of unbroken
    // blocking, dropping bottom-sheet animation frames. A single
    // setTimeout(0) per wrap costs ~0 ms but lets RN re-flush
    // pending UI events between decryptions. See issue #496.
    await yieldToEventLoop();

    let rumor: DecodedRumor | null = null;
    if (activeSigner === 'nsec') {
      const secretKey = await getMemoisedSecretKey(viewerPubkey);
      if (!secretKey) return;
      rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
    } else if (activeSigner === 'amber') {
      try {
        rumor = await unwrapWrapViaNip44(
          wrap,
          (ct, cp) => amberService.requestNip44DecryptSilent(ct, cp, viewerPubkey),
          onSkip,
        );
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const message = (error as Error)?.message ?? '';
        if (code === 'PERMISSION_NOT_GRANTED' || /PERMISSION_NOT_GRANTED/.test(message)) {
          // Same flag refreshDmInbox sets — Account screen surfaces
          // a one-tap grant button; without it, the live sub would
          // silently fail every wrap until the user re-enabled
          // Amber's blanket nip44_decrypt.
          setAmberNip44Permission('denied');
          return;
        }
        if (__DEV__) console.warn('[Nostr] live Amber NIP-17 unwrap failed:', error);
        return;
      }
    }
    if (!rumor) {
      if (__DEV__) console.log(`[Nostr] live wrap ${wrap.id.slice(0, 8)} no-rumor`);
      return;
    }
    if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

    // Group-route first — multi-recipient rumors are owned by the
    // group surface, not the 1:1 inbox. tryRouteGroupRumor handles
    // appendGroupMessage + notifyGroupMessage internally so an open
    // GroupConversationScreen auto-refreshes.
    const routeResult = await tryRouteGroupRumor(rumor, viewerPubkey, wrap.id);
    if (routeResult.kind !== 'not-group') {
      // OS notification (#279) — fired HERE (live path) not inside
      // tryRouteGroupRumor (which also runs on batch refresh). Only for
      // genuinely-fresh messages (backlog has old timestamps → silent),
      // skip my own, and suppressed when the user is viewing this group.
      if (routeResult.kind === 'routed' && isFreshArrival(routeResult.message.createdAt)) {
        const sender = routeResult.message.senderPubkey;
        if (sender.toLowerCase() !== viewerPubkey.toLowerCase()) {
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
        console.log(`[Nostr] live wrap ${wrap.id.slice(0, 8)} group-routed (${routeResult.kind})`);
      return;
    }

    const partnership = partnerFromRumor(rumor, viewerPubkey);
    if (!partnership) {
      if (__DEV__) console.log(`[Nostr] live wrap ${wrap.id.slice(0, 8)} no-partnership`);
      return;
    }

    // Follow gate (mirrors refreshDmInbox B1) — keeps non-followed
    // sender plaintext off AsyncStorage. Group rumors above don't
    // hit this gate because group membership is its own auth signal.
    if (!followPubkeysRef.current.has(partnership.partnerPubkey)) {
      if (__DEV__)
        console.log(
          `[Nostr] live wrap ${wrap.id.slice(0, 8)} dropped by follow-gate (partner=${partnership.partnerPubkey.slice(0, 8)})`,
        );
      // Defer fresh inbound for replay once follows hydrate (#851 F2). Skip my
      // own echoes and historical backlog (silent); persistence is left to the
      // next refreshDmInbox — see replayDeferredFollowGate.
      if (!partnership.fromMe && isFreshArrival(rumor.created_at)) {
        const deferredText = textForRumor(rumor);
        followGateBuffer.defer({
          partnerPubkey: partnership.partnerPubkey,
          entry: {
            id: wrap.id,
            partnerPubkey: partnership.partnerPubkey,
            fromMe: partnership.fromMe,
            createdAt: rumor.created_at,
            text: deferredText,
            wireKind: rumor.kind,
          },
          notify: { title: 'New message', body: rumor.content },
        });
      }
      return;
    }

    const wrapText = textForRumor(rumor);
    const wrapRow: DmMessageRow = {
      owner: viewerPubkey,
      eventId: wrap.id,
      conversation: partnership.partnerPubkey,
      createdAt: rumor.created_at,
      sender: partnership.fromMe ? viewerPubkey : partnership.partnerPubkey,
      content: wrapText,
      fromMe: partnership.fromMe,
      wireKind: rumor.kind,
    };
    const inboxEntry: DmInboxEntry = {
      id: wrap.id,
      partnerPubkey: partnership.partnerPubkey,
      fromMe: partnership.fromMe,
      createdAt: rumor.created_at,
      // For an order/receipt rumor (kind 16/17) `wrapText` is order JSON;
      // surface a readable preview. Plain DM rumors pass through unchanged.
      text: orderPreviewFromContent(wrapText, rumor.kind),
      wireKind: rumor.kind,
      // Inner rumor id (#857) — the delivery-store key for our own sent rows,
      // stable across the optimistic bubble + this live echo.
      rumorId: partnership.fromMe ? rumorEventId(rumor) : undefined,
    };

    // Serialise store-upsert + inbox-blob write so concurrent live wraps don't race each other.
    // The trailing `.catch` is load-bearing: without it a single throw leaves `writeChain` rejected and every later `.then(...)` skips its onFulfilled.
    writeChain = writeChain
      .then(async () => {
        if (cancelled) return;
        // Encrypted store write (#848) — idempotent by (owner, event_id), so
        // a wrap delivered by both the live sub and a near-simultaneous
        // refresh lands as one row (the old file read→merge→write dance and
        // its #811 clobbering hazard are gone).
        await upsertDmMessages([wrapRow]);
        knownWrapIds?.add(wrap.id);

        // Re-check after each await: logout may have wiped these stores while we were writing. Without these guards a freshly-decrypted wrap would re-populate disk after the user signed out.
        if (cancelled) return;
        const inboxRaw = await safeGetDmCacheItem(inboxCacheKey(viewerPubkey));
        const cachedInbox: DmInboxEntry[] = inboxRaw
          ? (() => {
              try {
                const parsed = JSON.parse(inboxRaw);
                return Array.isArray(parsed) ? parsed : [];
              } catch {
                return [];
              }
            })()
          : [];
        const merged = mergeInboxEntries(cachedInbox, [inboxEntry], DM_INBOX_CAP);
        if (cancelled) return;
        await AsyncStorage.setItem(inboxCacheKey(viewerPubkey), JSON.stringify(merged)).catch(
          () => {},
        );
      })
      .catch((e) => {
        if (__DEV__) console.warn('[Nostr] live wrap persist failed:', e);
      });
    await writeChain;
    if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

    queueInboxEntry(inboxEntry);
    notifyDmMessage(partnership.partnerPubkey);
    // OS notification (#279) — only genuinely-fresh inbound (backlog has
    // old rumor timestamps and stays silent), never my own echo;
    // suppressed when the user is viewing this thread.
    if (!partnership.fromMe && isFreshArrival(rumor.created_at)) {
      void fireMessageNotification({
        kind: 'dm',
        threadId: partnership.partnerPubkey,
        title: 'New message',
        body: rumor.content,
        data: { conversationPubkey: partnership.partnerPubkey },
      });
    }
    if (__DEV__)
      console.log(
        `[Nostr] live wrap ${wrap.id.slice(0, 8)} surfaced (partner=${partnership.partnerPubkey.slice(0, 8)})`,
      );
  };

  // Load the persisted kind-4 lastSeen cursor before opening the sub so the relay only re-streams events the user hasn't seen yet — without this, a heavy DM history floods the JS thread with hundreds of `live evt kind=4` deliveries on every cold start (each one a NIP-04 decrypt round-trip + setDmInbox re-render).
  let unsubscribe: (() => void) | null = null;
  (async () => {
    // Reuse loadLastSeen so parsing/validation matches refreshDmInbox's existing reads of the same key (#409 review). loadLastSeen returns undefined for missing/invalid values, which subscribeInboxDmsForViewer then falls back to its 7-day floor for.
    const sinceK4 = await loadLastSeen(inboxLastSeenKey(viewerPubkey)).catch(() => undefined);
    if (cancelled) return;
    // Pre-seed `knownWrapIds` from the encrypted store's wrap-id index
    // (#848 — one indexed id-only query, no plaintext leaves the DB). The
    // early-return in `handleInboxEvent` (top) checks this Set as the very
    // first thing and skips all downstream per-event work for known wraps.
    // Per issue #505. Runs after the one-time plaintext→DB migration so a
    // just-migrated install seeds the full id set.
    try {
      await ensureDmStoreMigrated(viewerPubkey);
      const storedWrapIds = await selectDmWrapIds(viewerPubkey);
      for (const id of storedWrapIds) knownWrapIds.add(id);
      // Also seed from persisted group messages — group-routed wraps
      // never land in the DM store (the tryRouteGroupRumor branch
      // returns before the row is built). Without this union every
      // cold start re-decrypts + re-routes the same group wraps the
      // relay re-streams since the last `since` cursor.
      const dmCount = knownWrapIds.size;
      const groupWrapIds = await listPersistedGroupWrapIds();
      for (const id of groupWrapIds) knownWrapIds.add(id);
      if (__DEV__) {
        console.log(
          `[Nostr] live DM sub: seeded knownWrapIds with ${dmCount} dm + ${knownWrapIds.size - dmCount} group wraps`,
        );
      }
      capKnownWrapIds(knownWrapIds);
    } catch (e) {
      // Seed-from-DB failed — leave knownWrapIds as the empty Set we
      // initialised at outer-scope. Known wraps re-stream through the
      // full handler (decrypt, route, upsert, queueInboxEntry,
      // notifyDmMessage). Two observable side effects vs the pre-#505
      // in-flow dedup check:
      //   1. `dmMessageListeners` registered for an open conversation
      //      will re-fire for messages already surfaced in a prior
      //      session.
      //   2. The `unwrapWrapNsec` / `unwrapWrapViaNip44` call runs
      //      unnecessarily for each known wrap (1–3 ms each).
      // The encrypted-store upsert is idempotent — it doesn't grow
      // unboundedly. We accept this regression on the failure path
      // because (a) DB read failures are extremely rare, and (b) the
      // alternative (resurrecting the lazy-load inside the handler)
      // would re-introduce the race + per-event prologue cost that
      // motivated #505 in the first place.
      if (__DEV__)
        console.warn('[Nostr] live DM sub: knownWrapIds seed failed, dedup degraded:', e);
    }
    if (cancelled) return;
    unsubscribe = subscribeInboxDmsForViewer({
      viewerPubkey,
      relays: readRelays,
      sinceK4,
      // Bound the kind-1059 backlog re-stream so arming the live sub doesn't
      // re-ingest the full wrap history on the JS thread (#751). Deeper backlog
      // is covered by refreshDmInbox's deferred backfill; new wraps stream live.
      wrapsLimit: COLD_INITIAL_WRAP_LIMIT,
      onEvent: (ev) => {
        // Fire-and-forget: handleInboxEvent awaits its own state, and any throw is caught + logged here so the sub keeps running. Whether a notification fires is gated inside on the message's own timestamp (isFreshArrival), not on EOSE.
        handleInboxEvent(ev).catch((e) => {
          if (__DEV__) console.warn('[Nostr] live DM handler failed:', e);
        });
      },
    });
    if (__DEV__) {
      console.log(
        `[Nostr] live DM sub (kinds 4 + 1059) opened for ${viewerPubkey.slice(0, 8)} on ${readRelays.length} relays, sinceK4=${sinceK4 ?? 'default-90d'}`,
      );
    }
  })();

  return () => {
    cancelled = true;
    flushPendingInbox();
    // Drop the follow-gate deferral buffer + unregister the replay hook
    // atomically with sub teardown (#851 F2). A wipe / account switch tears
    // the sub down, so buffered just-wiped wraps can never be replayed into
    // the next identity's inbox.
    setDeferredReplay(null);
    followGateBuffer.clear();
    if (unsubscribe) unsubscribe();
  };
}
