import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import * as nostrConnectService from '../services/nostrConnectService';
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
import {
  selectDmWrapIds,
  upsertDmMessages,
  hasConversationWith,
  type DmMessageRow,
} from '../services/dmDb';
import { parseOrderEvent, serializeOrder, orderPreviewText } from '../utils/orderEvents';
import { dmRowPreview } from '../utils/dmRowPreview';
import { nip04PlaintextCache, getMemoisedSecretKey } from './nostrSecretKeyCache';
import { notifyDmMessage } from './nostrEventBus';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { fireMessageNotification } from '../services/notificationService';
import { claimWrapNotification } from '../services/dmWrapNotificationDedupe';
import { subscribeInboxDmsForViewer } from '../services/dmLiveSubscription';
import { createYieldScheduler, NIP17_LOOP_YIELD_EVERY } from './nostrDecryptPacing';
import { capKnownWrapIds } from './knownWrapIdsCap';
import type { LiveSubFollowGateBuffer, DeferredFollowGateEntry } from './liveSubFollowGate';
import {
  COLD_INITIAL_WRAP_LIMIT,
  DM_INBOX_CAP,
  inboxLastSeenKey,
  loadLastSeen,
  mergeInboxEntries,
} from './nostrDmCache';
import { ensureDmStoreMigrated } from './dmStoreMigrationRunner';
import { createCoalescedFlushQueue } from '../utils/coalescedFlushQueue';
import type { RefreshDmInboxOptions } from './nostrContextTypes';

// --- Live-sub self-re-arm on relay drop / app resume (#934) ---
// The app-wide SimplePool deliberately does NOT auto-reconnect
// (enableReconnect stays default-false app-wide), so when the wrap
// subscription's WebSocket silently drops — relay idle timeout, network
// change, Android Doze suspending the socket on background — the foreground
// live sub goes deaf and nothing re-opens it. The user then has to
// pull-to-refresh to see missed DMs (the #934 symptom). We mirror the
// background DM watch's self-re-arm (#958): the sub's `onWrapsClose` schedules
// a backoff-scheduled re-open, and an AppState 'active' listener re-arms on
// resume (Doze can freeze the JS engine before onWrapsClose ever fires). A
// generation counter guards against re-arming after an intentional teardown
// (logout / account switch / relay-list change), and re-arms are silent by
// construction — re-subscribing over healthy sockets reuses the pool's open
// connections, the `isFreshArrival` gate mutes the backlog replay, and
// `knownWrapIds` + `claimWrapNotification` prevent duplicate work / alerts.
const LIVE_SUB_RECONNECT_BASE_DELAY_MS = 5_000;
const LIVE_SUB_RECONNECT_MAX_DELAY_MS = 5 * 60_000;
// A subscription that survived at least this long before closing counts as
// having been healthy — its next drop retries from the base delay; a
// rapid-fail (offline) keeps climbing the exponential backoff ladder.
const LIVE_SUB_HEALTHY_MIN_LIFETIME_MS = 60_000;
// Leading-edge debounce for the AppState `active` re-arm: the first resume
// re-arms immediately, but rapid foreground/background churn within this window
// is coalesced (the socket a moment-ago resume opened is still healthy, so
// re-subscribing again is wasted churn). A real Doze resume is far apart from
// the prior one, so it always clears this window and re-arms.
const LIVE_SUB_RESUME_DEBOUNCE_MS = 2_000;

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
  /** Optional: called once after a RECONNECT re-arm settles, to flush any
   * wraps missed while the socket was down. Not fired on the initial cold arm
   * (the normal cold-start + deferred-backfill path covers that). See #1035. */
  onReconnect?: (opts?: RefreshDmInboxOptions) => Promise<void>;
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
    onReconnect,
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
  // Budget-gated yield scheduler for the live-sub receive path (#1035).
  // Created once per subscription lifetime — shared across re-arms so the
  // elapsed-budget window carries over and a relay reconnect that delivers a
  // small burst doesn't reset the timer and pay zero yields. Disposed on
  // teardown. safetyEvery mirrors NIP17_LOOP_YIELD_EVERY so a pathological
  // stream can't monopolise the thread indefinitely even if performance.now
  // resolution is coarse. Single fresh wraps in the foreground never blow the
  // ~4 ms budget and cost zero RAF round-trips (~16 ms each); a cold-start
  // burst yields only when the budget is actually exhausted.
  //
  // The AbortController spans the subscription lifetime: teardown aborts it
  // BEFORE dispose(), which settles any in-flight maybeYield() awaiter (a bare
  // dispose() only cancels the RAF, leaving the awaiter — and its wrap, whose
  // id is already in knownWrapIds — hung forever).
  const wrapYieldAbort = new AbortController();
  const wrapYieldScheduler = createYieldScheduler({
    signal: wrapYieldAbort.signal,
    safetyEvery: NIP17_LOOP_YIELD_EVERY,
  });
  // Self-re-arm state (#934). `armGeneration` is bumped on every (re)arm and on
  // teardown; each underlying sub's `onWrapsClose` captures the generation live
  // at arm time, so a close belonging to a sub we already superseded (or a
  // torn-down sub) is stale and must not schedule a reconnect.
  let armGeneration = 0;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Wall-clock ms of the last AppState-resume-triggered re-arm, for the
  // leading-edge debounce below (rapid foreground/background churn coalesces).
  let lastResumeArmMs = 0;
  // True once the initial async arm (which seeds knownWrapIds + loads the
  // kind-4 `since` cursor) has opened the first sub. The AppState-resume
  // re-arm no-ops before this so it can't race ahead of the seed.
  let initialArmed = false;
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

  // Coalesce per-event inbox merges into batched setDmInbox calls — at most
  // one per ~150 ms quiet window or per 25 events. Without batching, a
  // relay-restream burst (e.g. cold start with 200+ kind-4 events queued)
  // causes one React re-render per event = 30+ rerenders/sec on the JS
  // thread, which is what locks the UI for 30 seconds; batching collapses
  // that into ~6 rerenders/sec at most. The queue flushes on the LEADING
  // edge, so the common case — one fresh DM arriving in the foreground —
  // surfaces immediately instead of idling out the full 150 ms window
  // (#934 item 3). Notifications still fire per-event so unread
  // counts/sounds aren't dropped.
  const inboxFlushQueue = createCoalescedFlushQueue<DmInboxEntry>({
    flushMs: 150,
    threshold: 25,
    onFlush: (batch) => setDmInbox((prev) => mergeInboxEntries(prev, batch, DM_INBOX_CAP)),
  });
  const queueInboxEntry = inboxFlushQueue.push;
  const flushPendingInbox = inboxFlushQueue.flush;

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
    // claimWrapNotification: the background watch (same JS context, no follow
    // gate) may have already notified for this wrap — never post twice (#279).
    if (item.notify && claimWrapNotification(item.entry.id)) {
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
          } else if (activeSigner === 'nip46') {
            plaintext = await nostrConnectService.requestNip04Decrypt(
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
      // LRU dies with the session). The store is the ONLY at-rest home now
      // (#850; the plaintext inbox-preview blob is retired). Same writeChain
      // as kind-1059 to serialize concurrent store writes. Also bump
      // inboxLastSeenKey (a bare timestamp) so refreshDmInbox's kind-4
      // `since` filter advances and doesn't re-fetch already-seen events.
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
          // N5 (#850): a store failure THROWS here (caught by the trailing
          // .catch), so the lastSeen bump below never runs for a row the DB
          // failed to keep — aligned with the kind-1059 path. The next
          // refresh's `since` floor then re-fetches the event instead of
          // silently skipping past an unpersisted message.
          await upsertDmMessages([k4Row]);
          const lastSeenRaw = await AsyncStorage.getItem(inboxLastSeenKey(viewerPubkey));
          const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : 0;
          if (ev.created_at > lastSeen) {
            // Re-check after the awaits: logout may have wiped these stores
            // while we were writing.
            if (cancelled) return;
            await AsyncStorage.setItem(inboxLastSeenKey(viewerPubkey), String(ev.created_at)).catch(
              () => {},
            );
          }
        })
        .catch((e) => {
          if (__DEV__) console.warn('[Nostr] live kind-4 persist failed:', e);
        });
      // Surface to the UI without awaiting the persist chain (#934 item 2):
      // awaiting meant every earlier event's SQLite upsert + inbox-blob
      // read-merge-write had to settle before THIS one could reach
      // setDmInbox, so under a backlog burst arrival latency grew with
      // queue depth. Persistence stays fully serialized via writeChain; a
      // failed persist is recovered by the next refreshDmInbox — the same
      // recovery model as the follow-gate replay path.
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
      // encrypted store (#850 — replaces the retired plaintext inbox blob scan).
      // Unknown senders are still stored + surfaced in-app silently.
      // (Follow-up: record markets the user actively ordered from — e.g. via the
      // Explore Market checkout — into a trust set so a first legitimate order
      // notifies too.) `partnerKnown` is checked BEFORE this event's own upsert,
      // so the very first order from a stranger can't self-qualify.
      const partnerFollowed = followPubkeysRef.current.has(partnerPubkey);
      let partnerKnown = partnerFollowed;
      writeChain = writeChain
        .then(async () => {
          if (cancelled) return;
          if (!partnerKnown) {
            partnerKnown = await hasConversationWith(viewerPubkey, partnerPubkey).catch(
              () => false,
            );
          }
          await upsertDmMessages([orderRow]).catch((e) => {
            if (__DEV__) console.warn('[DmStore] live order upsert failed:', e);
          });
        })
        .catch((e) => {
          if (__DEV__) console.warn('[Nostr] live order persist failed:', e);
        });
      // Surface to the UI without awaiting the persist chain (#934 item 2) —
      // same reasoning as the kind-4 path above.
      if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

      queueInboxEntry(orderInboxEntry);
      notifyDmMessage(partnerPubkey);
      // The OS-notification trust gate reads `partnerKnown`, which the
      // persist closure above resolves from the pre-merge inbox cache — so
      // the push (and only the push) still waits for the chain to settle.
      // `writeChain` here is the captured promise INCLUDING this event's
      // persist; later reassignments don't affect it, and its trailing
      // .catch means this continuation always runs.
      void writeChain.then(() => {
        if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;
        if (!fromMe && isFreshArrival(ev.created_at) && partnerKnown) {
          void fireMessageNotification({
            kind: 'dm',
            threadId: partnerPubkey,
            title: 'Marketplace update',
            body: preview,
            data: { conversationPubkey: partnerPubkey },
          });
        }
      });
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

    // Budget-gated yield before each per-wrap decryption (#1035 / #496).
    // Replaces the unconditional `yieldToEventLoop()` (one RAF ≈ 16 ms per
    // wrap regardless of load). `wrapYieldScheduler.maybeYield()` yields only
    // when accumulated JS work since the last yield has blown the ~4 ms frame
    // budget — a single fresh foreground wrap costs zero extra RAFs, while a
    // burst still yields at the right cadence. The safety cap (every
    // NIP17_LOOP_YIELD_EVERY wraps) backstops edge cases where decrypt runs
    // faster than performance.now resolution on some devices.
    await wrapYieldScheduler.maybeYield();
    // Torn down while parked on the yield (abort settles the awaiter): skip
    // post-teardown decrypt/persist work.
    if (cancelled) return;

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
    } else if (activeSigner === 'nip46') {
      // NIP-46 live unwrap. No silent-batch path (the silent variant
      // throws), so use the plain per-wrap decrypt over the bunker.
      // No PERMISSION_NOT_GRANTED concept, so no permission flag flip.
      try {
        rumor = await unwrapWrapViaNip44(
          wrap,
          (ct, cp) => nostrConnectService.requestNip44Decrypt(ct, cp, viewerPubkey),
          onSkip,
        );
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] live NIP-46 NIP-17 unwrap failed:', error);
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
        // claimWrapNotification: dedupe vs the background watch (#279).
        if (sender.toLowerCase() !== viewerPubkey.toLowerCase() && claimWrapNotification(wrap.id)) {
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
            id: wrap.id,
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
    // The trailing `.catch` is load-bearing: without it a single throw leaves `writeChain` rejected and every later `.then(...)` skips its onFulfilled.
    writeChain = writeChain
      .then(async () => {
        if (cancelled) return;
        // Encrypted store write (#848) — idempotent by (owner, event_id), so
        // a wrap delivered by both the live sub and a near-simultaneous
        // refresh lands as one row (the old file read→merge→write dance and
        // its #811 clobbering hazard are gone). The store is the ONLY
        // at-rest persistence (#850) — the plaintext inbox blob is retired.
        await upsertDmMessages([wrapRow]);
        knownWrapIds?.add(wrap.id);
      })
      .catch((e) => {
        if (__DEV__) console.warn('[Nostr] live wrap persist failed:', e);
      });
    // Surface to the UI without awaiting the persist chain (#934 item 2) —
    // same reasoning as the kind-4 path above. knownWrapIds was already
    // eagerly claimed at the top of this handler, so dedup doesn't depend
    // on the chain either.
    if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

    queueInboxEntry(inboxEntry);
    notifyDmMessage(partnership.partnerPubkey);
    // OS notification (#279) — only genuinely-fresh inbound (backlog has
    // old rumor timestamps and stays silent), never my own echo;
    // suppressed when the user is viewing this thread. claimWrapNotification
    // dedupes vs the background watch running in the same JS context.
    if (!partnership.fromMe && isFreshArrival(rumor.created_at) && claimWrapNotification(wrap.id)) {
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
        `[Nostr] live wrap ${wrap.id.slice(0, 8)} surfaced (partner=${partnership.partnerPubkey.slice(0, 8)})`,
      );
  };

  // Load the persisted kind-4 lastSeen cursor before opening the sub so the relay only re-streams events the user hasn't seen yet — without this, a heavy DM history floods the JS thread with hundreds of `live evt kind=4` deliveries on every cold start (each one a NIP-04 decrypt round-trip + setDmInbox re-render).
  let unsubscribe: (() => void) | null = null;
  // The kind-4 `since` cursor loaded once by the initial seed below; re-arms
  // (#934) reuse it. Re-streaming kind-4 from the same cursor on a re-arm is
  // safe: the closure-scoped `seen` Set, the RAM plaintext cache, and the
  // idempotent encrypted-store upsert all dedupe the re-fetched bytes.
  let sinceK4Cursor: number | undefined;

  const clearReconnectTimer = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  // How long after a RECONNECT re-arm we wait before firing refreshDmInbox to
  // flush the blind window. Gives the relay time to deliver the first batch of
  // backlogged wraps over the newly-opened WebSocket before the refresh runs;
  // chosen to cover one relay round-trip on a slow connection while staying
  // short enough that the user sees missed messages within a second of resume.
  const RECONNECT_REFRESH_SETTLE_MS = 1_500;

  // Open (or re-open) the underlying relay subscription. Bumps the generation
  // FIRST, then tears down any prior sub — so the prior sub's `onWrapsClose`,
  // which fires synchronously on close, sees a stale generation and no-ops
  // (never schedules a reconnect for a sub we intentionally superseded). Idempotent.
  const armSub = (): void => {
    if (cancelled) return;
    clearReconnectTimer();
    const generation = ++armGeneration;
    // isReconnect distinguishes a reconnect re-arm (after a socket drop or
    // Doze resume — #1035) from the initial cold arm. On reconnect, wraps
    // sent while the socket was down can rank below COLD_INITIAL_WRAP_LIMIT
    // (200) in the relay's newest-first ordering because NIP-17 randomises
    // the gift-wrap's `created_at` up to 48 h back (#469). Raising the limit
    // or querying with a `since` cursor would fight the deliberate no-since
    // design (which exists precisely to avoid #469 ranking gaps); instead we
    // fire a single `refreshDmInbox` after the re-arm settles — it queries
    // with limit 1000 and the full ingest engine, so it catches everything
    // the live sub's reconnect-window limit misses. The initial cold arm is
    // already covered by `dmColdStartBackfill`, so we only fire here on
    // reconnect (initialArmed = true before armSub is called by scheduleReconnect /
    // the AppState handler).
    const isReconnect = initialArmed;
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
      unsubscribe = null;
    }
    const armedAtMs = Date.now();
    unsubscribe = subscribeInboxDmsForViewer({
      viewerPubkey,
      relays: readRelays,
      sinceK4: sinceK4Cursor,
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
      // The wrap sub closed on every relay — the socket dropped and we've gone
      // deaf to new DMs (#934). Re-arm with backoff, unless this close belongs
      // to a superseded / torn-down sub (stale generation) or we were cancelled.
      onWrapsClose: () => {
        if (cancelled || generation !== armGeneration) return;
        // Lifetime-based health: a sub that survived a while was genuinely
        // connected, so its drop retries from the base delay; a rapid-fail
        // (offline) keeps climbing the exponential ladder.
        if (Date.now() - armedAtMs >= LIVE_SUB_HEALTHY_MIN_LIFETIME_MS) reconnectAttempt = 0;
        scheduleReconnect(generation);
      },
    });
    if (__DEV__) {
      console.log(
        `[Nostr] live DM sub (kinds 4 + 1059) opened for ${viewerPubkey.slice(0, 8)} on ${readRelays.length} relays, sinceK4=${sinceK4Cursor ?? 'default-7d'}`,
      );
    }
    // Reconnect blind-window flush (#1035): after a socket drop or Doze resume
    // re-arm, fire refreshDmInbox once the relay has had a moment to deliver
    // the newly-subscribed backlog. This catches wraps sent while the sub was
    // deaf that landed below COLD_INITIAL_WRAP_LIMIT in the relay's ordering
    // because NIP-17 randomises gift-wrap `created_at` up to 48 h back (#469).
    // Rationale for refreshDmInbox over a higher wrapsLimit: raising the live-
    // sub limit would replay the full backlog on the JS thread every reconnect,
    // whereas refreshDmInbox uses the decrypt-once gate (DB known-ids) so only
    // genuinely new wraps pay decrypt cost. The settle delay gives the relay
    // time to push the first burst before the refresh REQ lands — without it
    // the refresh and the live-sub REQ race and the refresh wins, leaving the
    // live-sub backlog duplicating the refresh's work.
    if (isReconnect && onReconnect) {
      setTimeout(() => {
        if (cancelled || generation !== armGeneration) return;
        if (__DEV__)
          console.log(
            '[Nostr] live DM reconnect — triggering refreshDmInbox to close blind window (#1035)',
          );
        onReconnect({ force: true }).catch((e) => {
          if (__DEV__) console.warn('[Nostr] live DM reconnect refresh failed:', e);
        });
      }, RECONNECT_REFRESH_SETTLE_MS);
    }
  };

  // Schedule a backoff-delayed re-arm after a socket drop (#934). Guards
  // against a stale generation, an intentional teardown, and a reconnect
  // already pending.
  const scheduleReconnect = (generation: number): void => {
    if (cancelled || generation !== armGeneration || reconnectTimer) return;
    const delay = Math.min(
      LIVE_SUB_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempt, 10),
      LIVE_SUB_RECONNECT_MAX_DELAY_MS,
    );
    reconnectAttempt += 1;
    if (__DEV__)
      console.warn(`[Nostr] live DM sub closed — re-arming in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (cancelled) return;
      armSub();
    }, delay);
  };

  // Re-arm on app resume (#934). Android Doze can suspend the relay WebSocket
  // (and freeze the JS engine) while backgrounded, so on return to `active`
  // the socket is often dead WITHOUT `onWrapsClose` ever having fired. Re-arm
  // proactively from the shortest backoff. No-ops until the initial seed has
  // armed the first sub, so a resume can't race ahead of the knownWrapIds seed.
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (cancelled || !initialArmed) return;
    if (next === 'active') {
      // Debounce rapid foreground/background churn (#986 review): re-arming on
      // every resume re-subscribes repeatedly when the user flicks between
      // apps, even though a socket opened a second ago is still healthy. A
      // genuine Doze resume is always far past this window, so it still re-arms.
      const now = Date.now();
      if (now - lastResumeArmMs < LIVE_SUB_RESUME_DEBOUNCE_MS) return;
      lastResumeArmMs = now;
      reconnectAttempt = 0;
      armSub();
    }
  });

  (async () => {
    // Reuse loadLastSeen so parsing/validation matches refreshDmInbox's existing reads of the same key (#409 review). loadLastSeen returns undefined for missing/invalid values, which subscribeInboxDmsForViewer then falls back to its 7-day floor for.
    sinceK4Cursor = await loadLastSeen(inboxLastSeenKey(viewerPubkey)).catch(() => undefined);
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
    armSub();
    initialArmed = true;
  })();

  return () => {
    cancelled = true;
    // Invalidate any in-flight close signal + pending reconnect FIRST (#934):
    // the `unsubscribe()` below fires `onWrapsClose` synchronously, and without
    // bumping the generation that intentional close would schedule a bogus
    // reconnect (a logout / account switch / relay-list change must fully stop
    // the sub, not resurrect it). Also stop the AppState-resume re-arm.
    armGeneration += 1;
    clearReconnectTimer();
    appStateSub.remove();
    flushPendingInbox();
    // Drop the follow-gate deferral buffer + unregister the replay hook
    // atomically with sub teardown (#851 F2). A wipe / account switch tears
    // the sub down, so buffered just-wiped wraps can never be replayed into
    // the next identity's inbox.
    setDeferredReplay(null);
    followGateBuffer.clear();
    // Abort first — settles any in-flight maybeYield() awaiter — then detach.
    wrapYieldAbort.abort();
    wrapYieldScheduler.dispose();
    if (unsubscribe) unsubscribe();
  };
}
