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
  type DecodedRumor,
} from '../utils/nip17Unwrap';
import { listPersistedGroupWrapIds } from '../services/groupMessagesStorageService';
import { perAccountKey } from '../services/perAccountStorage';
import { nip04PlaintextCache, getMemoisedSecretKey } from './nostrSecretKeyCache';
import { notifyDmMessage } from './nostrEventBus';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { fireMessageNotification } from '../services/notificationService';
import { subscribeInboxDmsForViewer } from '../services/dmLiveSubscription';
import { yieldToEventLoop } from './nostrDecryptPacing';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  type Nip17CacheEntry,
  safeParseRecord,
  writeNip17Cache,
  COLD_INITIAL_WRAP_LIMIT,
  DM_INBOX_CAP,
  inboxCacheKey,
  inboxLastSeenKey,
  safeGetDmCacheItem,
  loadLastSeen,
  mergeInboxEntries,
} from './nostrDmCache';

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
  } = params;
  const seen = new Set<string>();
  const SEEN_CAP = 4096;
  // In-memory mirror of the persisted NIP-17 wrap-id cache. Backed
  // by `knownWrapIdsRef` so the Set survives this effect's re-runs
  // (relay-list change → fresh effect instance). Seeded by union
  // below from AsyncStorage's wrap cache, but does NOT replace any
  // entries the prior sub instance added in-memory but the deferred
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
    if (ev.kind === 1059) knownWrapIds.add(ev.id);
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
      // No wrap-id cache for kind-4 (plaintext lives in RAM-only LRU); only persist the inbox preview blob. Same writeChain as kind-1059 to serialize concurrent inbox writes. Also bump inboxLastSeenKey so refreshDmInbox's kind-4 `since` filter advances and doesn't re-fetch already-seen events on the next refresh.
      writeChain = writeChain
        .then(async () => {
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

    // NIP-17 (kind-1059) — existing gift-wrap unwrap path. Local alias preserves original variable name without renaming through the body below.
    const wrap = ev;

    // Cache short-circuit: if refreshDmInbox already decrypted this
    // wrap and persisted it, the live sub has nothing to do — the
    // event was either delivered before the sub opened or arrived
    // via two paths (live + a near-simultaneous force-refresh).
    const cacheKey =
      activeSigner === 'nsec'
        ? perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, viewerPubkey)
        : activeSigner === 'amber'
          ? perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, viewerPubkey)
          : null;
    if (!cacheKey) return;
    // knownWrapIds is seeded eagerly up-front below (before the
    // subscription opens) — the in-flow lazy-load was removed in
    // #505 because it (a) raced when many wraps arrived together
    // and each tried to seed the Set concurrently, and (b) made
    // dedup hits pay through a long per-event prologue before the
    // check fired. The check for cached IDs now lives at the very
    // top of this function for kind-1059 events. This line is only
    // reached for genuinely new (not-yet-cached) wraps, OR — in
    // the rare case the seed failed (see the catch in the sub-open
    // block) — for wraps that should have been pre-known. In that
    // case the wrap re-decrypts; the persistent `wrapCache` write
    // below still guards against the on-disk cache filling
    // unboundedly, but the `dmMessageListeners` may fire a second
    // time for messages already shown in a previous session.
    // Acceptable trade-off because the seed only fails on
    // AsyncStorage I/O error which is extremely rare on Android.

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
      return;
    }

    const entry: Nip17CacheEntry = {
      id: wrap.id,
      wrapId: wrap.id,
      partnerPubkey: partnership.partnerPubkey,
      fromMe: partnership.fromMe,
      createdAt: rumor.created_at,
      text: textForRumor(rumor),
      wireKind: rumor.kind,
    };
    const inboxEntry: DmInboxEntry = {
      id: entry.id,
      partnerPubkey: entry.partnerPubkey,
      fromMe: entry.fromMe,
      createdAt: entry.createdAt,
      text: entry.text,
      wireKind: entry.wireKind,
    };

    // Serialise read→merge→write of wrap+inbox blobs so concurrent live wraps don't race each other.
    // The trailing `.catch` is load-bearing: without it a single throw leaves `writeChain` rejected and every later `.then(...)` skips its onFulfilled.
    writeChain = writeChain
      .then(async () => {
        if (cancelled) return;
        const wrapRaw = await AsyncStorage.getItem(cacheKey);
        const wrapCache = safeParseRecord<Nip17CacheEntry>(wrapRaw);
        if (wrapCache[wrap.id]) {
          knownWrapIds?.add(wrap.id);
          return;
        }
        wrapCache[wrap.id] = entry;
        // Re-check after each await: logout may have multiRemove'd these keys while we were reading. Without these guards a freshly-decrypted wrap would re-populate disk after the user signed out.
        if (cancelled) return;
        await writeNip17Cache(cacheKey, wrapCache);
        knownWrapIds?.add(wrap.id);

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
    // Pre-seed `knownWrapIds` from the persisted NIP-17 wrap-id
    // cache. One JSON.parse here saves N inline AsyncStorage reads
    // + parses inside `handleInboxEvent` when the relay re-streams
    // the backlog. The early-return in `handleInboxEvent` (top)
    // checks this Set as the very first thing and skips all
    // downstream per-event work for cache hits. Per issue #505.
    const wrapCacheKey =
      activeSigner === 'nsec'
        ? perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, viewerPubkey)
        : activeSigner === 'amber'
          ? perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, viewerPubkey)
          : null;
    if (wrapCacheKey) {
      try {
        const seedRaw = await AsyncStorage.getItem(wrapCacheKey);
        const seedCache = safeParseRecord<Nip17CacheEntry>(seedRaw);
        for (const id of Object.keys(seedCache)) knownWrapIds.add(id);
        // Also seed from persisted group messages — group-routed wraps
        // never land in the 1:1 wrapCache (the tryRouteGroupRumor
        // branch returns before the cache write). Without this union
        // every cold start re-decrypts + re-routes the same group
        // wraps the relay re-streams since the last `since` cursor.
        const dmCount = knownWrapIds.size;
        const groupWrapIds = await listPersistedGroupWrapIds();
        for (const id of groupWrapIds) knownWrapIds.add(id);
        if (__DEV__) {
          console.log(
            `[Nostr] live DM sub: seeded knownWrapIds with ${dmCount} dm + ${knownWrapIds.size - dmCount} group wraps`,
          );
        }
      } catch (e) {
        // Seed-from-disk failed — leave knownWrapIds as the empty
        // Set we initialised at outer-scope. Cached wraps re-stream
        // through the full handler (decrypt, route, write-cache,
        // queueInboxEntry, notifyDmMessage). Two observable side
        // effects vs the pre-#505 in-flow dedup check:
        //   1. `dmMessageListeners` registered for an open
        //      conversation will re-fire for messages already
        //      surfaced in a prior session.
        //   2. The `unwrapWrapNsec` / `unwrapWrapViaNip44` call
        //      runs unnecessarily for each cached wrap (1–3 ms each).
        // The persistent on-disk wrapCache write is idempotent —
        // it doesn't grow unboundedly. We accept this regression on
        // the failure path because (a) AsyncStorage.getItem I/O
        // errors are extremely rare on Android, and (b) the
        // alternative (resurrecting the lazy-load inside the
        // handler) would re-introduce the race + per-event prologue
        // cost that motivated #505 in the first place.
        if (__DEV__)
          console.warn('[Nostr] live DM sub: knownWrapIds seed failed, dedup degraded:', e);
      }
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
    if (unsubscribe) unsubscribe();
  };
}
