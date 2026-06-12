import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { touchNip17CacheEntry } from '../utils/nip17Cache';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { SignerType } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import {
  partnerFromRumor,
  unwrapWrapNsec,
  unwrapWrapViaNip44,
  textForRumor,
} from '../utils/nip17Unwrap';
import { perAccountKey } from '../services/perAccountStorage';
import {
  nip04PlaintextCache,
  appendLocalDmChains,
  getMemoisedSecretKey,
} from './nostrSecretKeyCache';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import {
  yieldToEventLoop,
  DECRYPT_FRAME_BUDGET_MS,
  createYieldScheduler,
  DECRYPT_YIELD_EVERY,
  NIP17_LOOP_YIELD_EVERY,
} from './nostrDecryptPacing';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  AMBER_NIP17_SKIP_KEY_BASE,
  NSEC_NIP17_SKIP_KEY_BASE,
  type Nip17CacheEntry,
  safeParseRecord,
  writeNip17Cache,
  loadNip17SkipSet,
  writeNip17SkipSet,
  COLD_INITIAL_WRAP_LIMIT,
  DM_INBOX_CAP,
  DM_CONV_CAP,
  inboxCacheKey,
  inboxLastSeenKey,
  convCacheKey,
  safeGetDmCacheItem,
  loadDmInboxFromCache,
  loadLastSeen,
  mergeInboxEntries,
} from './nostrDmCache';
import type { RefreshDmInboxOptions, ConversationMessage } from './nostrContextTypes';
import {
  isColdStartRefresh,
  shouldSkipForFreshness,
  shouldStampCursor,
  bypassesFreshnessTtl,
  shouldBypassSkipSet,
  shouldDropK4Since,
} from './dmRefreshGate';
import { startLiveDmSubscription } from './nostrLiveDmSub';
import { fetchConversationFor } from './nostrFetchConversation';
import { scheduleColdStartBackfill } from './dmColdStartBackfill';

/**
 * Options the provider threads into the DM-inbox + conversation hook.
 * These are the provider-owned slices `refreshDmInbox` / `fetchConversation`
 * / the live-DM-sub effect close over: the active identity (`pubkey`,
 * `isLoggedIn`, `signerType`), the follow gate (`followPubkeys`), and the
 * relay resolver (`getReadRelays`). Threading them in keeps the extracted
 * logic byte-for-byte equivalent to the inline provider version.
 */
export interface UseDmInboxOptions {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  followPubkeys: Set<string>;
  getReadRelays: () => string[];
}

/**
 * Everything the provider must surface (context value + session/logout/
 * switch flow hooks). The first block is exposed directly through the
 * NostrContext value; the trailing `hydrateDmInboxFromCache`,
 * `setDmInbox`, `setAmberNip44Permission`, and `knownWrapIdsRef` are used
 * by the provider's login / logout / switch-identity flows that own those
 * lifecycle transitions but mutate DM state.
 */
export interface UseDmInboxResult {
  dmInbox: DmInboxEntry[];
  dmInboxLoading: boolean;
  refreshDmInbox: (opts?: RefreshDmInboxOptions) => Promise<void>;
  fetchConversation: (otherPubkey: string) => Promise<ConversationMessage[]>;
  getCachedConversation: (otherPubkey: string) => Promise<ConversationMessage[]>;
  appendLocalDmMessage: (otherPubkey: string, msg: ConversationMessage) => Promise<void>;
  armLiveDmSub: () => void;
  amberNip44Permission: 'unknown' | 'granted' | 'denied';
  hydrateDmInboxFromCache: (pk: string) => Promise<void>;
  setDmInbox: React.Dispatch<React.SetStateAction<DmInboxEntry[]>>;
  setAmberNip44Permission: React.Dispatch<React.SetStateAction<'unknown' | 'granted' | 'denied'>>;
  knownWrapIdsRef: React.MutableRefObject<{ pubkey: string | null; set: Set<string> }>;
}

export function useDmInbox(options: UseDmInboxOptions): UseDmInboxResult {
  const { pubkey, isLoggedIn, signerType, followPubkeys, getReadRelays } = options;

  const [dmInbox, setDmInbox] = useState<DmInboxEntry[]>([]);
  const [dmInboxLoading, setDmInboxLoading] = useState(false);
  // Gates the live NIP-17 DM sub useEffect below. False on cold boot
  // so we don't burn JS-thread cycles unwrapping wraps the user can't
  // see yet (they're on Home, the Messages tab isn't mounted). Flipped
  // to true the first time Messages / Conversation / any DM-receiving
  // surface focuses via `armLiveDmSub()`. Once armed it stays armed for
  // the rest of the session. Cold-start Home stays responsive because
  // the per-wrap unwrap/route work moves to after the user has
  // explicitly chosen to look at messages.
  const [liveSubArmed, setLiveSubArmed] = useState(false);
  const [amberNip44Permission, setAmberNip44Permission] = useState<
    'unknown' | 'granted' | 'denied'
  >('unknown');

  // Single-flight guard: coalesce overlapping refreshDmInbox calls (e.g.
  // useFocusEffect firing while a pull-to-refresh is still in-flight) so
  // they don't race on the AsyncStorage wrap-id cache.
  const dmInboxInFlight = useRef<{
    promise: Promise<void>;
    includeNonFollows: boolean;
  } | null>(null);
  /** `performance.now()` of the last COMPLETED `refreshDmInbox` (`0` before
   * any). Drives the cold-start + freshness-TTL gates — see dmRefreshGate. */
  const dmInboxLastRefreshAt = useRef<number>(0);

  /** Eagerly hydrate `dmInbox` from the persisted NIP-17 inbox cache so
   * the Messages tab paints conversations on cold start instead of
   * staying blank for the relay-fetch + decrypt loop (~3-5 s). Called
   * from session-restore + post-login flows; refreshDmInbox handles
   * its own cache read separately for the delta-fetch path. */
  const hydrateDmInboxFromCache = useCallback(async (pk: string) => {
    const cached = await loadDmInboxFromCache(pk);
    if (cached.length > 0) setDmInbox(cached);
  }, []);

  /**
   * Decrypt one NIP-04 payload with whichever signer is active. Returns
   * null (not throw) on failure so batch callers don't abort the whole
   * loop on one bad event.
   */
  const decryptNip04ViaSigner = useCallback(
    async (counterpartyPubkey: string, ciphertext: string): Promise<string | null> => {
      if (!pubkey) return null;
      try {
        if (signerType === 'nsec') {
          const secretKey = await getMemoisedSecretKey(pubkey);
          if (!secretKey) return null;
          return await nostrService.decryptNip04WithSecret(
            secretKey,
            counterpartyPubkey,
            ciphertext,
          );
        }
        if (signerType === 'amber') {
          return await amberService.requestNip04Decrypt(ciphertext, counterpartyPubkey, pubkey);
        }
        return null;
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] NIP-04 decrypt failed:', error);
        return null;
      }
    },
    [pubkey, signerType],
  );

  /**
   * Silent Amber NIP-44 decrypt wrapped as the callback shape expected by
   * unwrapWrapViaNip44. Throws on PERMISSION_NOT_GRANTED so the caller
   * can flip the permission flag and stop iterating rather than falling
   * back to the Intent dialog (which would flood one dialog per wrap).
   */
  const amberNip44DecryptSilent = useCallback(
    async (ciphertext: string, counterpartyPubkey: string): Promise<string> => {
      if (!pubkey) throw new Error('Not logged in');
      return amberService.requestNip44DecryptSilent(ciphertext, counterpartyPubkey, pubkey);
    },
    [pubkey],
  );

  const getCachedConversation = useCallback(
    async (otherPubkey: string): Promise<ConversationMessage[]> => {
      if (!pubkey) return [];
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return [];
      try {
        const raw = await safeGetDmCacheItem(convCacheKey(pubkey, normalized));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    [pubkey],
  );

  const appendLocalDmMessage = useCallback(
    async (otherPubkey: string, msg: ConversationMessage): Promise<void> => {
      if (!pubkey) return;
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return;
      // Serialize concurrent appends to the same conversation. Without
      // this, two rapid sends could both read the same `existing` array,
      // each merge their msg, both write back — last write wins, the
      // earlier optimistic row is silently lost. Per Copilot review #509.
      const chainKey = `${pubkey}:${normalized}`;
      const prev = appendLocalDmChains.get(chainKey) ?? Promise.resolve();
      const next = prev.then(async () => {
        try {
          const key = convCacheKey(pubkey, normalized);
          const raw = await AsyncStorage.getItem(key);
          const existing: ConversationMessage[] = raw
            ? (() => {
                try {
                  const parsed = JSON.parse(raw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          // Dedup on id (same key would arise from a double-tap retry).
          const map = new Map<string, ConversationMessage>();
          for (const m of existing) map.set(m.id, m);
          map.set(msg.id, msg);
          const merged = Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
          const capped =
            merged.length <= DM_CONV_CAP ? merged : merged.slice(merged.length - DM_CONV_CAP);
          await AsyncStorage.setItem(key, JSON.stringify(capped));
        } catch {
          // Swallow — the in-memory setMessages above already painted
          // the bubble. The remount-after-back regression is precisely
          // what this method exists to fix, so a write failure is
          // unfortunate but not destructive (next relay echo will
          // repopulate the cache).
        }
      });
      // `.catch` on the chain entry so a single failure doesn't poison
      // every subsequent append on this conversation.
      appendLocalDmChains.set(
        chainKey,
        next.catch(() => {}),
      );
      await next;
    },
    [pubkey],
  );

  // Thread-open data fetch lives in `nostrFetchConversation` (#703). The
  // hook threads in the identity + relay + NIP-04 decrypt dependencies it
  // closes over; the body is unchanged.
  const fetchConversation = useCallback(
    (otherPubkey: string): Promise<ConversationMessage[]> =>
      fetchConversationFor({
        pubkey,
        isLoggedIn,
        signerType,
        getReadRelays,
        decryptNip04ViaSigner,
        otherPubkey,
      }),
    [pubkey, isLoggedIn, signerType, getReadRelays, decryptNip04ViaSigner],
  );

  // Stable self-reference so the cold-start backfill can re-invoke
  // refreshDmInbox without it listing itself as a dependency (declared here,
  // assigned just after the useCallback).
  const refreshDmInboxRef = useRef<((opts?: RefreshDmInboxOptions) => Promise<void>) | null>(null);
  const refreshDmInbox = useCallback(
    async (opts?: RefreshDmInboxOptions): Promise<void> => {
      if (!pubkey || !isLoggedIn) {
        setDmInbox([]);
        return;
      }
      // [PerfBlock] timing bracket — surfaces the wall-clock cost of
      // a full inbox refresh including NIP-17 decrypt loops. Look for
      // matched `refreshDmInbox: …ms` pairs in logcat to isolate
      // multi-second freezes that coincide with this call. #554.
      const __perfBlockStart = performance.now();
      const signal = opts?.signal;
      // Dev-only "Following only=off" bypass — read once at the top so
      // the closure captures a stable value across the async work below.
      // When true, all six follow-gate `continue`s in the decrypt loops
      // become no-ops AND the cache hydrate skips its filter so the
      // already-cached unfollowed entries don't get masked.
      const includeNonFollows = opts?.includeNonFollows === true;
      // Cold start = first refresh this session (incl. force: the real cold
      // load is MessagesScreen's on-mount focus refresh; the cold-start wrap
      // cap + #788 macro-task yield must apply to it). See dmRefreshGate.
      const isColdStart = isColdStartRefresh(dmInboxLastRefreshAt.current);
      // Skip-set / TTL / kind-4 `since` policies are pure functions in
      // dmRefreshGate — the cold-start backfill (#751) bypasses only the
      // TTL; it must NOT inherit the #743 force-refresh cache bypasses
      // (that was the every-cold-start decrypt sweep, #846).
      const bypassSkipSet = shouldBypassSkipSet(opts);
      if (
        shouldSkipForFreshness(
          dmInboxLastRefreshAt.current,
          bypassesFreshnessTtl(opts),
          performance.now(),
        )
      ) {
        return;
      }
      // Single-flight: piggy-back on in-flight task ONLY when its includeNonFollows matches; otherwise wait then re-run with the wider option.
      if (dmInboxInFlight.current) {
        if (dmInboxInFlight.current.includeNonFollows === includeNonFollows) {
          return dmInboxInFlight.current.promise;
        }
        await dmInboxInFlight.current.promise;
      }

      // Capture local references once so the closure isn't affected by
      // mid-flight signer / identity changes. If we detect pubkey/signerType
      // has changed by the time we're about to commit, we bail without
      // mutating state to avoid leaking entries into the wrong session.
      const refreshForPubkey = pubkey;
      // Local helper: encapsulates the follow gate so all seven sites in
      // the cache hydrate + NIP-04 + NIP-17 decrypt loops + final merge
      // reuse the same predicate. When includeNonFollows is true the
      // gate is a no-op (every pubkey passes), so callers can opt out
      // of the parental-control filter from a single switch.
      const refreshForSigner = signerType;
      const refreshFollows = followPubkeys;
      const passesFollowGate = (pk: string): boolean => includeNonFollows || refreshFollows.has(pk);

      let refreshCompleted = false; // set after commit; gates the stamp (#788 — see helper)

      const task = (async () => {
        setDmInboxLoading(true);
        try {
          const readRelays = getReadRelays();
          const refreshStart = performance.now();
          let nip04CacheHits = 0;
          let nip04FreshDecrypts = 0;
          // NIP-17 perf counters — emitted in the `[Perf] refreshDmInbox`
          // line so #193 can be tracked post-merge. `nip17Hits` /
          // `nip17Misses` capture the cache-hit ratio per refresh;
          // `nip17Evictions` shows whether the 5000-cap is actually
          // squeezing entries out (was previously invisible — the FIFO
          // sort-and-slice path ran silently).
          let nip17Hits = 0;
          let nip17Misses = 0;
          let nip17Evictions = 0;
          let nip17CacheSize = 0;
          // Wraps short-circuited by the negative-result skip-set (#743).
          // Counted separately from positive-cache hits so we can see
          // how much decrypt work the skip-set is saving per refresh.
          let nip17SkipHits = 0;
          // Number of actual `setTimeout(0)` yields the NIP-17 loop
          // performed this refresh — emitted in the [Perf] nip17-cache
          // line so we can track how often the new frame-budget
          // scheduler trips (#532). Higher = more breathing room
          // given back to the UI thread.
          let nip17YieldCount = 0;

          // PR B: load persisted inbox + last-seen so we can (a) paint
          // cached entries before the relay round-trip finishes and
          // (b) only fetch events newer than the last one we saw.
          const [cachedInboxRaw, lastSeen] = await Promise.all([
            safeGetDmCacheItem(inboxCacheKey(refreshForPubkey)),
            loadLastSeen(inboxLastSeenKey(refreshForPubkey)),
          ]);
          const cachedInbox: DmInboxEntry[] = cachedInboxRaw
            ? (() => {
                try {
                  const parsed = JSON.parse(cachedInboxRaw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          // Render the cached entries immediately so the Messages tab
          // isn't blank while the relay fetches the delta. The followers
          // set may have changed since the cache was written; re-apply
          // the filter here so unfollowed senders don't resurrect.
          if (cachedInbox.length > 0) {
            const filteredCache = cachedInbox.filter((e) => passesFollowGate(e.partnerPubkey));
            setDmInbox(filteredCache);
          }

          // For pull-to-refresh / force refresh, skip the `since` filter
          // entirely. NIP-59 wraps have a randomised `created_at` (up to
          // 2 days back), so a `since` cutoff is unreliable for catching
          // freshly-published wraps — the relay will drop wraps whose
          // randomised stamp falls behind the cutoff. The wrap-id cache
          // dedupes the re-fetched bytes, so the cost of dropping the
          // floor is just the relay round-trip, not re-decrypt. Group
          // messages especially benefit since GroupsScreen / GroupConv
          // open with `force: true` to chase newly-arrived rumors.
          const { kind4, kind1059 } = await nostrService.fetchInboxDmEvents(
            refreshForPubkey,
            readRelays,
            {
              // kind-4 `since` floor policy → dmRefreshGate.shouldDropK4Since (#751/#846). Wraps ignore `since` internally regardless (random NIP-59 ts).
              ...(shouldDropK4Since(opts, isColdStart) ? {} : { since: lastSeen }),
              signal,
              ...(isColdStart ? { limit: COLD_INITIAL_WRAP_LIMIT } : {}),
            },
          );
          if (signal?.aborted) return;
          const entries: DmInboxEntry[] = [];

          // NIP-04 — partner pubkey is in the envelope, so we can apply
          // the follow filter BEFORE decrypting. A non-followed sender
          // never gets a round-trip through Amber, let alone land in
          // state. Same cache/parallel pattern as fetchConversation:
          // pull cached plaintext synchronously, decrypt misses in
          // DECRYPT_YIELD_EVERY-sized parallel batches.
          const k4Targets: {
            ev: (typeof kind4)[0];
            fromMe: boolean;
            partnerPubkey: string;
          }[] = [];
          for (const ev of kind4) {
            const fromMe = ev.pubkey.toLowerCase() === refreshForPubkey;
            const partnerPubkey = (
              fromMe ? (ev.tags.find((t) => t[0] === 'p')?.[1] ?? '') : ev.pubkey
            ).toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(partnerPubkey)) continue;
            if (!passesFollowGate(partnerPubkey)) continue;
            k4Targets.push({ ev, fromMe, partnerPubkey });
          }
          // Fast pass — cache lookup only.
          const k4Misses: typeof k4Targets = [];
          for (const t of k4Targets) {
            const hit = nip04PlaintextCache.get(t.ev.id);
            if (hit !== undefined) {
              nip04CacheHits++;
              entries.push({
                id: t.ev.id,
                partnerPubkey: t.partnerPubkey,
                fromMe: t.fromMe,
                createdAt: t.ev.created_at,
                text: hit,
                wireKind: 4,
              });
            } else {
              k4Misses.push(t);
            }
          }
          // Slow pass — parallel decrypt of misses in yield-able chunks.
          for (let i = 0; i < k4Misses.length; i += DECRYPT_YIELD_EVERY) {
            if (signal?.aborted) return;
            const batch = k4Misses.slice(i, i + DECRYPT_YIELD_EVERY);
            const batchResults = await Promise.all(
              batch.map(async (t) => {
                nip04FreshDecrypts++;
                const plaintext = await decryptNip04ViaSigner(t.partnerPubkey, t.ev.content);
                if (plaintext === null) return null;
                nip04PlaintextCache.set(t.ev.id, plaintext);
                return { t, plaintext };
              }),
            );
            for (const r of batchResults) {
              if (!r) continue;
              entries.push({
                id: r.t.ev.id,
                partnerPubkey: r.t.partnerPubkey,
                fromMe: r.t.fromMe,
                createdAt: r.t.ev.created_at,
                text: r.plaintext,
                wireKind: 4,
              });
            }
            if (i + DECRYPT_YIELD_EVERY < k4Misses.length) await yieldToEventLoop();
          }
          if (signal?.aborted) return;

          // NIP-17 — partner pubkey is INSIDE the encrypted rumor, so we
          // have to decrypt to know who sent it. For the nsec signer this
          // is cheap pure-JS, so iterate freely and drop non-follows after
          // decrypt. For Amber, guard behind the opt-in toggle + silent-only
          // decrypt path: if Amber hasn't pre-approved nip44_decrypt, we
          // flip amberNip44Permission='denied' so Account can prompt the
          // user for a one-time grant, and stop iterating instead of
          // flooding dialogs.
          const onSkip = (reason: string, wrapId: string) => {
            if (__DEV__) console.warn(`[Nostr] NIP-17 inbox unwrap skip (${wrapId}): ${reason}`);
          };

          if (refreshForSigner === 'nsec' && kind1059.length > 0) {
            const secretKey = await getMemoisedSecretKey(refreshForPubkey);
            if (secretKey) {
              // Persistent wrap-id cache mirroring the Amber branch. Only
              // ever contains rumors from followed senders — see the
              // filter gate below. This is the fix for #176. Per-account
              // namespaced (#288).
              const nsecCacheKey = perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, refreshForPubkey);
              // Negative-result skip-set: wrap ids that were successfully
              // decrypted in a prior refresh but produced no inbox entry
              // (group rumor or non-followed sender). The relay re-delivers
              // the same wraps on every warm refresh and each miss pays the
              // full NIP-44 schnorr + decrypt cost again. Persisting the
              // set lets the loop short-circuit to a Set.has(id) check.
              // Only the wrap id (a public nonce on the outer envelope) is
              // stored — no plaintext, no sender pubkey. (#743)
              const nsecSkipKey = perAccountKey(NSEC_NIP17_SKIP_KEY_BASE, refreshForPubkey);
              const [raw, skipSet] = await Promise.all([
                safeGetDmCacheItem(nsecCacheKey),
                loadNip17SkipSet(nsecSkipKey),
              ]);
              const cache = safeParseRecord<Nip17CacheEntry>(raw);
              const newlyCached: Nip17CacheEntry[] = [];
              let unfollowedPurged = 0;
              let touched = 0;
              let skipSetDirty = false;
              // Frame-budget scheduler (#532): yield whenever we've held
              // the JS thread for >= DECRYPT_FRAME_BUDGET_MS, with the
              // count-based modulo kept as a safety cap. On abort, the
              // scheduler hard-cancels any pending setTimeout so the
              // loop unwinds in the next microtask instead of waiting
              // out one more scheduler round-trip.
              // coldStart (#788): swap RAF yields for setTimeout(0) macro-task
              // yields on the first refresh, where RAF starves and the loop
              // otherwise stalls the JS thread in 1.4–2.1 s bursts.
              const nsecYield = createYieldScheduler({ signal, safetyEvery: NIP17_LOOP_YIELD_EVERY, coldStart: isColdStart }); // prettier-ignore
              try {
                for (const wrap of kind1059) {
                  // Time-budget yield + abort check (#286, #532). Covers
                  // the cache-hit path too — without it, a long run of
                  // cache hits walks the whole kind1059 list synchronously
                  // and any back-tap during refresh appears frozen.
                  await nsecYield.maybeYield();
                  if (signal?.aborted) return;
                  const cached = cache[wrap.id];
                  if (cached) {
                    nip17Hits++;
                    // Cache entry exists → it was from a followed sender
                    // when first stored. Re-check against the *current*
                    // follow set so unfollowed partners don't keep
                    // surfacing from cache. Purge the stale entry so we
                    // don't keep dragging it through every refresh until
                    // the 5000-cap LRU finally evicts it.
                    if (!passesFollowGate(cached.partnerPubkey)) {
                      delete cache[wrap.id];
                      unfollowedPurged++;
                      continue;
                    }
                    // LRU touch (#193): re-insert at the tail so this hot
                    // entry survives the next overflow eviction. Without
                    // this the cache is FIFO-by-first-write — a thread
                    // the user re-opens regularly can be evicted just
                    // because 5000 newer wraps happened to arrive first.
                    touchNip17CacheEntry(cache, wrap.id);
                    touched++;
                    entries.push({
                      id: cached.wrapId,
                      partnerPubkey: cached.partnerPubkey,
                      fromMe: cached.fromMe,
                      createdAt: cached.createdAt,
                      text: cached.text,
                      wireKind: cached.wireKind,
                    });
                    continue;
                  }
                  // Skip-set hit: this wrap was previously decrypted and
                  // found to carry a group rumor or a non-followed sender —
                  // short-circuit without re-paying the NIP-44 decrypt cost.
                  // Bypassed on force-refresh so a newly-followed contact's
                  // older wraps get re-evaluated. (#743)
                  if (!bypassSkipSet && skipSet.has(wrap.id)) {
                    nip17SkipHits++;
                    continue;
                  }
                  nip17Misses++;
                  if (signal?.aborted) return; // bail before the ~25ms schnorr unwrapWrapNsec
                  const rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
                  // No per-decrypt yield: the frame-budget scheduler at the loop top
                  // already yields on DECRYPT_FRAME_BUDGET_MS, covering unwrapWrapNsec.
                  if (!rumor) continue;
                  // Multi-recipient (group) rumors: route to group storage
                  // and short-circuit the DM-inbox path. The 1:1 inbox
                  // never sees group messages — they belong to a different
                  // surface (GroupConversationScreen).
                  const routeResult = await tryRouteGroupRumor(rumor, refreshForPubkey, wrap.id);
                  if (routeResult.kind !== 'not-group') {
                    // Successful decrypt, no inbox entry — add to skip-set
                    // so subsequent refreshes don't re-decrypt. (#743)
                    skipSet.add(wrap.id);
                    skipSetDirty = true;
                    continue;
                  }
                  const partnership = partnerFromRumor(rumor, refreshForPubkey);
                  if (!partnership) continue;
                  // B1 — drop non-follows at the data layer. No caching, no
                  // state. The filter is load-bearing ("parental control"),
                  // so it runs here not in the view.
                  if (!passesFollowGate(partnership.partnerPubkey)) {
                    // Successful decrypt, non-followed sender — add to
                    // skip-set. If the user later follows this sender the
                    // skip-set is not invalidated: the live NIP-17 sub
                    // delivers new wraps in real time, and pull-to-refresh
                    // (force: true) bypasses the skip-set CHECK (the wrap
                    // is re-decrypted and the follow gate re-evaluated; if
                    // the sender is still non-followed the wrap id is just
                    // re-added to the same skip-set). (#745)
                    skipSet.add(wrap.id);
                    skipSetDirty = true;
                    continue;
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
                  cache[wrap.id] = entry;
                  newlyCached.push(entry);
                  entries.push({
                    id: entry.id,
                    partnerPubkey: entry.partnerPubkey,
                    fromMe: entry.fromMe,
                    createdAt: entry.createdAt,
                    text: entry.text,
                    wireKind: entry.wireKind,
                  });
                }
              } finally {
                nsecYield.dispose();
              }
              nip17YieldCount += nsecYield.yieldCount;

              // Persist if we mutated the cache for any reason: new
              // entries, follow-set purges, or LRU touches (#193) — the
              // touch reorders insertion order, and we need that order
              // on disk for it to survive app restart.
              if (newlyCached.length > 0 || unfollowedPurged > 0 || touched > 0) {
                nip17Evictions += await writeNip17Cache(nsecCacheKey, cache);
              }
              if (skipSetDirty) {
                await writeNip17SkipSet(nsecSkipKey, skipSet);
              }
              nip17CacheSize = Object.keys(cache).length;
            }
          } else if (refreshForSigner === 'amber' && kind1059.length > 0) {
            // Always run the unwrap loop — Amber's silent content-resolver path returns PERMISSION_NOT_GRANTED on the first wrap if the user hasn't granted nip44_decrypt yet, which we surface via setAmberNip44Permission('denied') so NostrScreen can show the one-shot "Grant permission in Amber" button. Closes #404.
            // Persistent cache keyed by wrap id. Only ever contains rumors from *followed* senders — see the filter gate below. Per-account namespaced (#288).
            const amberCacheKey = perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, refreshForPubkey);
            // Negative-result skip-set — same semantics as the nsec branch.
            // (#743)
            const amberSkipKey = perAccountKey(AMBER_NIP17_SKIP_KEY_BASE, refreshForPubkey);
            const [rawAmber, amberSkipSet] = await Promise.all([
              safeGetDmCacheItem(amberCacheKey),
              loadNip17SkipSet(amberSkipKey),
            ]);
            const cache = safeParseRecord<Nip17CacheEntry>(rawAmber);
            const newlyCached: Nip17CacheEntry[] = [];
            let permissionDenied = false;
            let touched = 0;
            let unfollowedPurged = 0;
            let amberSkipSetDirty = false;
            // Frame-budget scheduler (#532) + coldStart macro-task yields
            // (#788) — see nsec branch above for the rationale on both.
            const amberYield = createYieldScheduler({ signal, safetyEvery: NIP17_LOOP_YIELD_EVERY, coldStart: isColdStart }); // prettier-ignore
            try {
              for (const wrap of kind1059) {
                // Time-budget yield + abort check (#286, #532) — see nsec branch above for rationale.
                await amberYield.maybeYield();
                if (signal?.aborted) return;
                const cached = cache[wrap.id];
                if (cached) {
                  nip17Hits++;
                  // Re-check against current follow set; purge if no longer followed so we don't drag stale entries through every refresh.
                  if (!passesFollowGate(cached.partnerPubkey)) {
                    delete cache[wrap.id];
                    unfollowedPurged++;
                    continue;
                  }
                  touchNip17CacheEntry(cache, wrap.id);
                  touched++;
                  entries.push({
                    id: cached.wrapId,
                    partnerPubkey: cached.partnerPubkey,
                    fromMe: cached.fromMe,
                    createdAt: cached.createdAt,
                    text: cached.text,
                    wireKind: cached.wireKind,
                  });
                  continue;
                }
                // Skip-set hit — short-circuit without an Amber IPC call.
                // Bypassed on force-refresh. (#743)
                if (!bypassSkipSet && amberSkipSet.has(wrap.id)) {
                  nip17SkipHits++;
                  continue;
                }
                nip17Misses++;
                if (signal?.aborted) return; // bail before the Amber IPC round-trip (same as nsec path)
                // Uncached — unwrap via Amber's silent content-resolver path.
                // If Amber hasn't granted blanket nip44_decrypt permission,
                // this throws PERMISSION_NOT_GRANTED and we stop iterating.
                try {
                  const rumor = await unwrapWrapViaNip44(wrap, amberNip44DecryptSilent, onSkip);
                  if (!rumor) continue;
                  // Multi-recipient (group) rumors: route to group storage
                  // and short-circuit the DM-inbox path.
                  const routeResult = await tryRouteGroupRumor(rumor, refreshForPubkey, wrap.id);
                  if (routeResult.kind !== 'not-group') {
                    amberSkipSet.add(wrap.id);
                    amberSkipSetDirty = true;
                    continue;
                  }
                  const partnership = partnerFromRumor(rumor, refreshForPubkey);
                  if (!partnership) continue;
                  // B1 — never cache rumors from non-followed senders. (#743)
                  if (!passesFollowGate(partnership.partnerPubkey)) {
                    amberSkipSet.add(wrap.id);
                    amberSkipSetDirty = true;
                    continue;
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
                  cache[wrap.id] = entry;
                  newlyCached.push(entry);
                  entries.push({
                    id: entry.id,
                    partnerPubkey: entry.partnerPubkey,
                    fromMe: entry.fromMe,
                    createdAt: entry.createdAt,
                    text: entry.text,
                    wireKind: entry.wireKind,
                  });
                } catch (error) {
                  const code = (error as { code?: string })?.code;
                  const message = (error as Error)?.message ?? '';
                  if (code === 'PERMISSION_NOT_GRANTED' || /PERMISSION_NOT_GRANTED/.test(message)) {
                    permissionDenied = true;
                    if (__DEV__) {
                      console.log(
                        `[Nostr] Amber NIP-44 permission not granted — stopping NIP-17 unwrap for this refresh`,
                      );
                    }
                    break;
                  }
                  if (__DEV__) console.warn('[Nostr] Amber NIP-17 unwrap failed:', error);
                }
              }
            } finally {
              amberYield.dispose();
            }
            nip17YieldCount += amberYield.yieldCount;

            setAmberNip44Permission(permissionDenied ? 'denied' : 'granted');

            // Persist on new entries, LRU touches (#193 — touches reorder insertion order which we need on disk), or unfollowed-partner purges (so the purge survives the next launch).
            if (newlyCached.length > 0 || touched > 0 || unfollowedPurged > 0) {
              nip17Evictions += await writeNip17Cache(amberCacheKey, cache);
            }
            if (amberSkipSetDirty) {
              await writeNip17SkipSet(amberSkipKey, amberSkipSet);
            }
            nip17CacheSize = Object.keys(cache).length;
          }

          // Identity-change guard: if the user logged out or switched signer
          // while we were mid-flight, don't leak these entries into a
          // different session's state. Abort signal is treated the same way:
          // if the navigating-away screen has signalled cancel, skip the
          // commit so we don't pay the merge / persist cost.
          if (refreshForPubkey !== pubkey || refreshForSigner !== signerType) return;
          if (signal?.aborted) return;

          // PR B: merge cached-with-fresh, keep at most DM_INBOX_CAP
          // entries (newest-first), then persist + update last-seen.
          const merged = mergeInboxEntries(cachedInbox, entries, DM_INBOX_CAP);
          const filteredFinal = merged.filter((e) => passesFollowGate(e.partnerPubkey));

          // Perf summary: one line per refresh, grep with `\[Perf\] refreshDmInbox`.
          // The `nip17-cache` segment (#193) lets us see at a glance
          // whether the LRU swap is keeping hot entries warm: a healthy
          // long-running inbox should converge to hits >> misses with
          // size pinned at the 5000 cap and a non-zero evictions counter
          // each refresh once the cap is reached.
          console.log(
            `[Perf] refreshDmInbox: ` +
              `${(performance.now() - refreshStart).toFixed(0)}ms, ` +
              `k4=${kind4.length} (hits=${nip04CacheHits}, fresh=${nip04FreshDecrypts}), ` +
              `k1059=${kind1059.length}, ` +
              `since=${lastSeen ?? 0}, ` +
              `fresh=${entries.length}, ` +
              `merged=${merged.length}, ` +
              `rendered=${filteredFinal.length}`,
          );
          console.log(
            `[Perf] nip17-cache: ` +
              `hits=${nip17Hits}, ` +
              `skipHits=${nip17SkipHits}, ` +
              `misses=${nip17Misses}, ` +
              `evictions=${nip17Evictions}, ` +
              `size=${nip17CacheSize}, ` +
              `yields=${nip17YieldCount} (budget=${DECRYPT_FRAME_BUDGET_MS}ms, cap=${NIP17_LOOP_YIELD_EVERY})`,
          );

          setDmInbox(filteredFinal);

          // Persist merged list + new last-seen. Only kind-4 contributes
          // here — NIP-59 wraps have randomized timestamps (~2 days in
          // either direction of the real publish time) for plausible
          // deniability, so wrap.created_at can't be used as a
          // monotonic publish-time cursor. Including them here would
          // ratchet lastSeen into the future on the first wrap with a
          // forward-dated ts, then cause subsequent kind-4 since-filters
          // to drop legitimate recent NIP-04 messages. fetchInboxDmEvents
          // already drops the `since` filter for kind-1059 entirely (see
          // the matching comment there); the cache dedupes wraps by id.
          const newLastSeen = Math.max(lastSeen ?? 0, ...kind4.map((e) => e.created_at));
          await Promise.all([
            AsyncStorage.setItem(inboxCacheKey(refreshForPubkey), JSON.stringify(merged)).catch(
              () => {},
            ),
            newLastSeen > (lastSeen ?? 0)
              ? AsyncStorage.setItem(inboxLastSeenKey(refreshForPubkey), String(newLastSeen)).catch(
                  () => {},
                )
              : Promise.resolve(),
          ]);
          refreshCompleted = true; // inbox committed — safe to stamp the cursor
        } catch (error) {
          if (__DEV__) console.warn('[Nostr] refreshDmInbox failed:', error);
        } finally {
          setDmInboxLoading(false);
        }
      })();

      dmInboxInFlight.current = { promise: task, includeNonFollows };
      try {
        await task;
        // Stamp only for a refresh that COMPLETED its work — gate on
        // `refreshCompleted`, not `signal.aborted` (see the helper). #788.
        if (shouldStampCursor(!refreshCompleted)) {
          dmInboxLastRefreshAt.current = performance.now();
        }
      } finally {
        dmInboxInFlight.current = null;
        const __perfBlockMs = Math.round(performance.now() - __perfBlockStart);
        // Only surface costly refreshes — sub-200 ms ones aren't
        // contributors to the multi-second freezes we're hunting.
        if (__perfBlockMs > 200) {
          console.log(`[PerfBlock] refreshDmInbox: ${__perfBlockMs}ms`);
        }
      }

      // Cold-start backfill (#751) — recent slice painted fast above; top up to
      // the full backlog in the background (deferred + abortable). See module.
      scheduleColdStartBackfill({
        isColdStart,
        signal,
        includeNonFollows,
        refreshRef: refreshDmInboxRef,
      });
    },
    [
      pubkey,
      isLoggedIn,
      signerType,
      getReadRelays,
      followPubkeys,
      decryptNip04ViaSigner,
      amberNip44DecryptSilent,
    ],
  );
  // Keep the self-ref pointed at the latest refreshDmInbox closure.
  refreshDmInboxRef.current = refreshDmInbox;

  useEffect(() => {
    if (!isLoggedIn) setDmInbox([]);
  }, [isLoggedIn]);

  // Live mirror of `followPubkeys` for the long-lived kind-1059
  // subscription below. The sub captures `followPubkeys` at the time
  // the effect ran; without this ref, a follow added after sub
  // creation would be invisible to the gate until the sub
  // reconnected. Reading via ref keeps the gate fresh per event
  // without thrashing the subscription on every contacts update.
  const followPubkeysRef = useRef(followPubkeys);
  useEffect(() => {
    followPubkeysRef.current = followPubkeys;
  }, [followPubkeys]);

  // Idempotent — any DM-surface (Messages tab, ConversationScreen)
  // calls this on focus. The first call flips `liveSubArmed`, the
  // gated useEffect below re-runs and opens the live NIP-17 sub.
  // Subsequent calls are no-ops (React bails on identical setState).
  const armLiveDmSub = useCallback(() => {
    setLiveSubArmed(true);
  }, []);

  // In-memory dedup Set that survives live-DM-sub re-opens. The sub
  // useEffect below re-runs when getReadRelays changes — e.g. when the
  // relay-list refresh adds a new relay 9 s into cold start. Without
  // this ref, the new effect instance creates a fresh Set and re-seeds
  // it from AsyncStorage's wrap cache. That snapshot is stale by the
  // deferred-write window, so all wraps the prior sub already
  // decrypted re-stream from the relays (same `since` cursor) and get
  // re-routed/re-decrypted. Carrying the Set forward keeps the
  // early-return in handleInboxEvent honest across the re-open.
  // Reset only when the viewer changes (sign out / account switch).
  const knownWrapIdsRef = useRef<{ pubkey: string | null; set: Set<string> }>({
    pubkey: null,
    set: new Set(),
  });

  // Long-lived kind-1059 (NIP-17 gift wrap) subscription for the
  // current viewer (#349). Without this, new incoming wraps only
  // surface via pull-to-refresh or the 30 s-TTL useFocusEffect on
  // MessagesScreen — which means the user sits on the Messages tab
  // for up to half a minute after a friend sends a DM with nothing
  // happening on screen.
  //
  // Per-event handler:
  //  1. Dedupe against (a) a session-scoped `seen` set so the same
  //     wrap delivered by multiple relays is processed once, and
  //     (b) the persisted Nip17CacheEntry cache so wraps previously
  //     decrypted by `refreshDmInbox` short-circuit.
  //  2. Decrypt with the active signer's NIP-17 helper — same code
  //     path used by `refreshDmInbox` (`unwrapWrapNsec` for nsec,
  //     `unwrapWrapViaNip44` + Amber silent-decrypt for Amber).
  //  3. Try `tryRouteGroupRumor` first. Multi-recipient kind-14
  //     rumors land in group storage and fire the existing
  //     `notifyGroupMessage` listener — open GroupConversationScreen
  //     re-loads automatically.
  //  4. 1:1 rumors that pass the follow gate are written to the
  //     persistent NIP-17 wrap cache (so the next inbox / thread open
  //     can short-circuit), appended to `dmInbox` state, and
  //     broadcast to `dmMessageListeners` so an open
  //     ConversationScreen for that peer re-fetches.
  //
  // Follow gate: matches `refreshDmInbox`'s default — non-followed
  // sender wraps are decrypted (so we can group-route them) but NOT
  // cached or surfaced to dmInbox state. The dev-mode "All (dev)"
  // toggle still relies on the next pull-to-refresh to surface
  // unfollowed live wraps; live delivery for that view is a
  // follow-up. Rationale: caching unfollowed plaintext on disk
  // violates the "B1 — never cache rumors from non-followed senders"
  // invariant in `refreshDmInbox`.
  //
  // Writes to the wrap + inbox caches go through a serial queue to
  // avoid racing with `refreshDmInbox` (both read-modify-write the
  // same AsyncStorage blobs). The queue is per-effect-instance; the
  // single-flight guard in `refreshDmInbox` serialises on its side.
  useEffect(() => {
    if (!isLoggedIn || !pubkey || !signerType) return;
    // Wait until a DM-surface (Messages tab, ConversationScreen) has
    // focused at least once before opening the live sub. On cold boot
    // the user is on Home, so we skip ~5 s of per-wrap unwrap/route/
    // dedup JS-thread work. First Messages focus flips `liveSubArmed`,
    // this effect re-runs, sub opens, drain happens then — when the
    // user is explicitly looking at messages and a brief loading
    // state is expected.
    if (!liveSubArmed) return;
    // The subscription body lives in `nostrLiveDmSub` (#703). It closes
    // over the effect-instance snapshots (`viewerPubkey` / `activeSigner`)
    // plus the live current props for the mid-flight identity guards, and
    // returns the teardown function used as this effect's cleanup.
    return startLiveDmSubscription({
      viewerPubkey: pubkey,
      activeSigner: signerType,
      pubkey,
      signerType,
      readRelays: getReadRelays(),
      knownWrapIdsRef,
      followPubkeysRef,
      setDmInbox,
      setAmberNip44Permission,
    });
  }, [isLoggedIn, pubkey, signerType, getReadRelays, liveSubArmed]);

  return {
    dmInbox,
    dmInboxLoading,
    refreshDmInbox,
    fetchConversation,
    getCachedConversation,
    appendLocalDmMessage,
    armLiveDmSub,
    amberNip44Permission,
    hydrateDmInboxFromCache,
    setDmInbox,
    setAmberNip44Permission,
    knownWrapIdsRef,
  };
}
