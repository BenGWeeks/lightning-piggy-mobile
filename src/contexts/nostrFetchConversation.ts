import AsyncStorage from '@react-native-async-storage/async-storage';
import { touchNip17CacheEntry } from '../utils/nip17Cache';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { SignerType } from '../types/nostr';
import { partnerFromRumor, unwrapWrapNsec, unwrapWrapViaNip44 } from '../utils/nip17Unwrap';
import { perAccountKey } from '../services/perAccountStorage';
import { nip04PlaintextCache, getMemoisedSecretKey } from './nostrSecretKeyCache';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { yieldToEventLoop, DECRYPT_YIELD_EVERY } from './nostrDecryptPacing';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  type Nip17CacheEntry,
  safeParseRecord,
  writeNip17Cache,
  DM_CONV_CAP,
  inboxLastSeenKey,
  convCacheKey,
  convLastSeenKey,
  safeGetDmCacheItem,
  loadLastSeen,
  mergeConversationMessages,
} from './nostrDmCache';
import type { ConversationMessage } from './nostrContextTypes';

/**
 * Inputs `fetchConversation` closes over in the provider. Extracted into a
 * standalone async function (#703) — `useDmInbox` threads in the active
 * identity (`pubkey`, `isLoggedIn`, `signerType`), the relay resolver
 * (`getReadRelays`), and the per-signer NIP-04 decrypt closure
 * (`decryptNip04ViaSigner`). No logic / ordering changed; the function
 * returns the merged message list exactly as the inline version did.
 */
export interface FetchConversationParams {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  getReadRelays: () => string[];
  decryptNip04ViaSigner: (counterpartyPubkey: string, ciphertext: string) => Promise<string | null>;
  otherPubkey: string;
}

export async function fetchConversationFor(
  params: FetchConversationParams,
): Promise<ConversationMessage[]> {
  const { pubkey, isLoggedIn, signerType, getReadRelays, decryptNip04ViaSigner, otherPubkey } =
    params;
  if (!pubkey || !isLoggedIn) return [];
  const normalized = otherPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return [];

  // Perf instrumentation — unconditional (not __DEV__ gated) so we
  // can grep the same line out of logcat on a production APK to
  // compare cold-cache vs warm-cache thread opens. Numbers are
  // counts-only — no plaintext / pubkey logged beyond a short id.
  const perfStart = performance.now();
  let nip17CacheHits = 0;
  let nip17FreshDecrypts = 0;
  let nip04CacheHits = 0;
  let nip04FreshDecrypts = 0;

  const readRelays = getReadRelays();
  const decrypted: ConversationMessage[] = [];

  // PR B: load persisted per-peer conversation + per-peer last-seen.
  // Merge cached-and-fresh at the end; keep the cache for the next
  // open so we only ever re-decrypt the (typically 0-few) events
  // that arrived since last open.
  const [convRaw, convLastSeen] = await Promise.all([
    safeGetDmCacheItem(convCacheKey(pubkey, normalized)),
    loadLastSeen(convLastSeenKey(pubkey, normalized)),
  ]);
  const cachedConv: ConversationMessage[] = convRaw
    ? (() => {
        try {
          const parsed = JSON.parse(convRaw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : [];

  // NIP-04 — peer-scoped fetch, two directions, filtered by since.
  const kind4Events = await nostrService.fetchDirectMessageEvents(pubkey, normalized, readRelays, {
    since: convLastSeen,
  });
  // Two-pass decrypt with module-level LRU cache:
  //  1. Pull plaintext synchronously for events already in the
  //     cache — no decrypt round-trip, no Amber IPC, no CPU.
  //  2. Decrypt the misses in parallel (`Promise.all`). For nsec
  //     this drains the JS queue faster than a serial for-await
  //     loop; for Amber the IPC round-trips pipeline. Chunk the
  //     Promise.all in slices of DECRYPT_YIELD_EVERY to yield to
  //     the UI thread between batches on very long threads.
  const freshDecryptTargets: {
    idx: number;
    counterparty: string;
    ev: (typeof kind4Events)[0];
  }[] = [];
  const cachedPlaintexts: {
    idx: number;
    fromMe: boolean;
    text: string;
    ev: (typeof kind4Events)[0];
  }[] = [];
  for (let i = 0; i < kind4Events.length; i++) {
    const ev = kind4Events[i];
    const fromMe = ev.pubkey === pubkey;
    const counterparty = fromMe ? normalized : ev.pubkey.toLowerCase();
    const hit = nip04PlaintextCache.get(ev.id);
    if (hit !== undefined) {
      nip04CacheHits++;
      cachedPlaintexts.push({ idx: i, fromMe, text: hit, ev });
    } else {
      freshDecryptTargets.push({ idx: i, counterparty, ev });
    }
  }
  // Parallel decrypt of misses, in yield-able chunks.
  const freshResults: ({
    idx: number;
    fromMe: boolean;
    text: string;
    ev: (typeof kind4Events)[0];
  } | null)[] = [];
  for (let i = 0; i < freshDecryptTargets.length; i += DECRYPT_YIELD_EVERY) {
    const batch = freshDecryptTargets.slice(i, i + DECRYPT_YIELD_EVERY);
    const batchResults = await Promise.all(
      batch.map(async (t) => {
        nip04FreshDecrypts++;
        const plaintext = await decryptNip04ViaSigner(t.counterparty, t.ev.content);
        if (plaintext === null) return null;
        // Cache the successful decrypt. Event ids are immutable so
        // we can store unconditionally — no staleness possible.
        nip04PlaintextCache.set(t.ev.id, plaintext);
        const fromMe = t.ev.pubkey === pubkey;
        return { idx: t.idx, fromMe, text: plaintext, ev: t.ev };
      }),
    );
    freshResults.push(...batchResults);
    if (i + DECRYPT_YIELD_EVERY < freshDecryptTargets.length) await yieldToEventLoop();
  }
  // Merge cached + fresh preserving original event order.
  const orderedByIndex = new Array<ConversationMessage | null>(kind4Events.length).fill(null);
  for (const c of cachedPlaintexts) {
    orderedByIndex[c.idx] = {
      id: c.ev.id,
      fromMe: c.fromMe,
      text: c.text,
      createdAt: c.ev.created_at,
    };
  }
  for (const r of freshResults) {
    if (!r) continue;
    orderedByIndex[r.idx] = {
      id: r.ev.id,
      fromMe: r.fromMe,
      text: r.text,
      createdAt: r.ev.created_at,
    };
  }
  for (const m of orderedByIndex) if (m !== null) decrypted.push(m);

  // NIP-17 — partner pubkey is hidden inside the encrypted rumor,
  // so we can't peer-scope at the relay. `refreshDmInbox` (which
  // the Messages tab fires on focus with a 30s TTL) already
  // decrypts every wrap addressed to us and writes the plaintext
  // keyed by wrap id to the persistent cache. Serve the NIP-17
  // portion of THIS thread from that cache first — if the cache
  // has ANY entries, we skip the expensive inbox-wide relay
  // fetch entirely (#190).
  //
  // Cold-cache fallback: if the cache has no entries at all (first
  // app run post-login, or just-logged-out-logged-back-in) we
  // still hit the relay so the thread renders even before any
  // refreshDmInbox has fired. Subsequent opens short-circuit.
  //
  // Staleness tradeoff: a wrap that arrived in the last <30s and
  // hasn't been pulled by refreshDmInbox yet won't show until the
  // next tab focus. For a chat UX that's a non-issue.
  const signerWrapCacheKey =
    signerType === 'nsec'
      ? perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, pubkey)
      : signerType === 'amber'
        ? perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, pubkey)
        : null;
  const wrapCacheRaw = signerWrapCacheKey ? await safeGetDmCacheItem(signerWrapCacheKey) : null;
  const wrapCache = safeParseRecord<Nip17CacheEntry>(wrapCacheRaw);
  const cachedWrapEntries = Object.values(wrapCache);
  let skippedInboxFetch = false;
  let fastPathTouched = 0;
  if (cachedWrapEntries.length > 0) {
    // Cache populated — serve peer-matching wraps directly, skip relay fetch.
    for (const entry of cachedWrapEntries) {
      nip17CacheHits++;
      if (entry.partnerPubkey !== normalized) continue;
      // LRU touch (#193) — opening this thread is a "use" of these entries; without the touch they age out FIFO and a thread the user re-opens regularly can be evicted just because newer wraps arrived first.
      touchNip17CacheEntry(wrapCache, entry.wrapId);
      fastPathTouched++;
      decrypted.push({
        id: entry.wrapId,
        fromMe: entry.fromMe,
        text: entry.text,
        createdAt: entry.createdAt,
      });
    }
    skippedInboxFetch = true;
  }
  // Persist the touched-cache so LRU order survives restarts.
  if (fastPathTouched > 0 && signerWrapCacheKey) {
    await writeNip17Cache(signerWrapCacheKey, wrapCache);
  }
  const inboxLastSeenForWraps = skippedInboxFetch
    ? undefined
    : await loadLastSeen(inboxLastSeenKey(pubkey));
  const { kind1059 } = skippedInboxFetch
    ? {
        kind1059: [] as Awaited<ReturnType<typeof nostrService.fetchInboxDmEvents>>['kind1059'],
      }
    : await nostrService.fetchInboxDmEvents(pubkey, readRelays, {
        since: inboxLastSeenForWraps,
      });
  if (kind1059.length > 0) {
    const onSkip = (reason: string, wrapId: string) => {
      if (__DEV__) console.warn(`[Nostr] NIP-17 thread unwrap skip (${wrapId}): ${reason}`);
    };
    if (signerType === 'nsec') {
      const secretKey = await getMemoisedSecretKey(pubkey);
      if (secretKey) {
        // Reuse the persistent wrap-id cache populated by
        // refreshDmInbox (#176). For wraps that aren't cached yet
        // (typically arrived between the last inbox refresh and
        // this thread open), we decrypt AND write them back so the
        // next thread open across ANY conversation can short-circuit
        // without waiting for the next inbox refresh.
        const nsecCacheKey = perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, pubkey);
        const raw = await safeGetDmCacheItem(nsecCacheKey);
        const cache = safeParseRecord<Nip17CacheEntry>(raw);
        const newlyCached: Nip17CacheEntry[] = [];
        let nip17Decrypted = 0;
        let threadTouched = 0;
        for (const wrap of kind1059) {
          const cached = cache[wrap.id];
          if (cached) {
            nip17CacheHits++;
            if (cached.partnerPubkey !== normalized) continue;
            // LRU touch (#193) — see fast-path above for rationale.
            touchNip17CacheEntry(cache, wrap.id);
            threadTouched++;
            decrypted.push({
              id: wrap.id,
              fromMe: cached.fromMe,
              text: cached.text,
              createdAt: cached.createdAt,
            });
            continue;
          }
          nip17FreshDecrypts++;
          const rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
          if (++nip17Decrypted % DECRYPT_YIELD_EVERY === 0) await yieldToEventLoop();
          if (!rumor) continue;
          // If this is a multi-recipient group rumor, route it to
          // the group store and skip 1:1 caching. Opening a DM
          // thread shouldn't backfill group rumors into the 1:1
          // cache — they belong to GroupConversationScreen.
          const routeResult = await tryRouteGroupRumor(rumor, pubkey, wrap.id);
          if (routeResult.kind !== 'not-group') continue;
          const partnership = partnerFromRumor(rumor, pubkey);
          if (!partnership) continue;
          // Cache every successfully decrypted wrap, even if it
          // belongs to a different thread — cache is keyed by wrap
          // id, not by thread, so later opens of OTHER threads
          // benefit too. Filter to this thread's partner only for
          // the render-side `decrypted` array.
          const entry: Nip17CacheEntry = {
            id: wrap.id,
            wrapId: wrap.id,
            partnerPubkey: partnership.partnerPubkey,
            fromMe: partnership.fromMe,
            createdAt: rumor.created_at,
            text: rumor.content,
            wireKind: rumor.kind,
          };
          cache[wrap.id] = entry;
          newlyCached.push(entry);
          if (partnership.partnerPubkey !== normalized) continue;
          decrypted.push({
            id: wrap.id,
            fromMe: partnership.fromMe,
            text: rumor.content,
            createdAt: rumor.created_at,
          });
        }
        if (newlyCached.length > 0 || threadTouched > 0) {
          await writeNip17Cache(nsecCacheKey, cache);
        }
      }
    } else if (signerType === 'amber') {
      const amberCacheKey = perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, pubkey);
      const raw = await safeGetDmCacheItem(amberCacheKey);
      const cache = safeParseRecord<Nip17CacheEntry>(raw);
      let threadTouched = 0;
      for (const wrap of kind1059) {
        const cached = cache[wrap.id];
        if (cached) {
          nip17CacheHits++;
          if (cached.partnerPubkey !== normalized) continue;
          touchNip17CacheEntry(cache, wrap.id);
          threadTouched++;
          decrypted.push({
            id: wrap.id,
            fromMe: cached.fromMe,
            text: cached.text,
            createdAt: cached.createdAt,
          });
          continue;
        }
        nip17FreshDecrypts++;
        // Thread view falls back to the Intent dialog if the silent path rejects — the user has actively opened this thread, one approval prompt per wrap is fine. Inbox refresh uses the silent-only path to avoid the flood; cached entries cover the hot path.
        try {
          const rumor = await unwrapWrapViaNip44(
            wrap,
            (ct, cp) => amberService.requestNip44Decrypt(ct, cp, pubkey),
            onSkip,
          );
          if (!rumor) continue;
          const routeResult = await tryRouteGroupRumor(rumor, pubkey, wrap.id);
          if (routeResult.kind !== 'not-group') continue;
          const partnership = partnerFromRumor(rumor, pubkey);
          if (!partnership || partnership.partnerPubkey !== normalized) continue;
          decrypted.push({
            id: wrap.id,
            fromMe: partnership.fromMe,
            text: rumor.content,
            createdAt: rumor.created_at,
          });
        } catch (error) {
          if (__DEV__) console.warn('[Nostr] Amber NIP-17 thread unwrap failed:', error);
        }
      }
      if (threadTouched > 0) {
        await writeNip17Cache(amberCacheKey, cache);
      }
    }
  }

  // PR B: merge fresh decrypt results with what we had cached
  // from previous opens. Fresh takes precedence via `mergeConversationMessages`
  // Map semantics so re-ordered or edited events (rare) land right.
  const merged = mergeConversationMessages(cachedConv, decrypted, DM_CONV_CAP);

  // Single-line perf summary — grep `[Perf] fetchConversation` out
  // of logcat to compare cold-cache vs warm-cache thread opens.
  // Cold cache shows `hits=0, fresh=N` — whole inbox decrypted.
  // Warm cache shows `hits≈N, fresh=0` — all cache short-circuits.
  console.log(
    `[Perf] fetchConversation(${normalized.slice(0, 8)}): ` +
      `${(performance.now() - perfStart).toFixed(0)}ms, ` +
      `k4=${kind4Events.length} (hits=${nip04CacheHits}, fresh=${nip04FreshDecrypts}), ` +
      `k1059=${nip17CacheHits + nip17FreshDecrypts} (hits=${nip17CacheHits}, fresh=${nip17FreshDecrypts}, skippedFetch=${skippedInboxFetch}), ` +
      `since=${convLastSeen ?? 0}, ` +
      `cached=${cachedConv.length}, ` +
      `merged=${merged.length}`,
  );

  // Persist merged list + new per-peer last-seen so next open of
  // THIS thread sees only the delta. Fire-and-forget; the caller
  // gets its data immediately via `merged`. kind-1059 deliberately
  // excluded — wrap timestamps are randomized per NIP-59 and would
  // poison the kind-4 since cursor (same reasoning as the inbox
  // path; see fetchInboxDmEvents + refreshDmInbox).
  const newConvLastSeen = Math.max(convLastSeen ?? 0, ...kind4Events.map((e) => e.created_at));
  Promise.all([
    AsyncStorage.setItem(convCacheKey(pubkey, normalized), JSON.stringify(merged)).catch(() => {}),
    newConvLastSeen > (convLastSeen ?? 0)
      ? AsyncStorage.setItem(convLastSeenKey(pubkey, normalized), String(newConvLastSeen)).catch(
          () => {},
        )
      : Promise.resolve(),
  ]).catch(() => {});

  return merged;
}
