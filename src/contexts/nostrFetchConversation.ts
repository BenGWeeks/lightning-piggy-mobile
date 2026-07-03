import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import * as nostrConnectService from '../services/nostrConnectService';
import type { SignerType } from '../types/nostr';
import { unwrapWrapNsec, unwrapWrapViaNip44, type DecodedRumor } from '../utils/nip17Unwrap';
import {
  getConversationMessages,
  hasStoredWraps,
  upsertDmMessages,
  type DmMessageRow,
} from '../services/dmDb';
import { nip04PlaintextCache, getMemoisedSecretKey } from './nostrSecretKeyCache';
import { yieldToEventLoop, DECRYPT_YIELD_EVERY } from './nostrDecryptPacing';
import {
  DM_CONV_CAP,
  inboxLastSeenKey,
  convCacheKey,
  convLastSeenKey,
  safeGetDmCacheItem,
  loadLastSeen,
  mergeConversationMessages,
} from './nostrDmCache';
import { ingestInboxWraps } from './dmWrapIngest';
import { ensureDmStoreMigrated } from './dmStoreMigrationRunner';
import type { ConversationMessage } from './nostrContextTypes';

/**
 * Inputs `fetchConversation` closes over in the provider. Extracted into a
 * standalone async function (#703) — `useDmInbox` threads in the active
 * identity (`pubkey`, `isLoggedIn`, `signerType`), the relay resolver
 * (`getReadRelays`), and the per-signer NIP-04 decrypt closure
 * (`decryptNip04ViaSigner`). The NIP-17 portion of a thread is served from
 * the encrypted DM store's indexed (owner, conversation, created_at) slice
 * (#848) — the plaintext wrap-cache file this used to scan is retired.
 */
export interface FetchConversationParams {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  getReadRelays: () => string[];
  decryptNip04ViaSigner: (counterpartyPubkey: string, ciphertext: string) => Promise<string | null>;
  otherPubkey: string;
  // Cancels the relay fetch + decrypt loop when the user navigates away (#868).
  // Mirrors refreshDmInbox's opts.signal: the loop bails at its yield points so
  // a back-press mid-fetch stops chewing the JS thread, and re-entering can
  // abort-and-replace an in-flight fetch instead of stacking a second loop.
  signal?: AbortSignal;
}

export async function fetchConversationFor(
  params: FetchConversationParams,
): Promise<ConversationMessage[]> {
  const {
    pubkey,
    isLoggedIn,
    signerType,
    getReadRelays,
    decryptNip04ViaSigner,
    otherPubkey,
    signal,
  } = params;
  if (!pubkey || !isLoggedIn) return [];
  if (signal?.aborted) return [];
  const normalized = otherPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return [];

  // One-time plaintext→encrypted store migration (#848) — memoised, so this
  // is a Map lookup after the first call. A notification deep-link can open
  // a thread before any inbox refresh ran, so the trigger lives here too.
  await ensureDmStoreMigrated(pubkey);

  // Perf instrumentation — unconditional (not __DEV__ gated) so we
  // can grep the same line out of logcat on a production APK to
  // compare cold-store vs warm-store thread opens. Numbers are
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
    // Bail between batches once the caller aborts (#868) — same yield-point
    // cancellation refreshDmInbox/ingestInboxWraps already do. Stops a back-
    // press mid-fetch from draining the rest of the decrypt loop.
    if (signal?.aborted) break;
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
  // Persist fresh NIP-04 decrypts to the encrypted store (#848) so the next
  // open of ANY surface is decrypt-once — the RAM LRU dies with the session.
  const k4Rows: DmMessageRow[] = [];
  for (const r of freshResults) {
    if (!r) continue;
    k4Rows.push({
      owner: pubkey,
      eventId: r.ev.id,
      conversation: normalized,
      createdAt: r.ev.created_at,
      sender: r.fromMe ? pubkey : normalized,
      content: r.text,
      fromMe: r.fromMe,
      wireKind: 4,
    });
  }
  if (k4Rows.length > 0) {
    await upsertDmMessages(k4Rows).catch((e) => {
      if (__DEV__) console.warn('[DmStore] thread kind-4 upsert failed:', e);
    });
  }
  // Merge cached + fresh preserving original event order.
  const orderedByIndex = new Array<ConversationMessage | null>(kind4Events.length).fill(null);
  for (const c of cachedPlaintexts) {
    orderedByIndex[c.idx] = {
      id: c.ev.id,
      fromMe: c.fromMe,
      text: c.text,
      createdAt: c.ev.created_at,
      wireKind: 4, // these are kind-4 NIP-04 events
    };
  }
  for (const r of freshResults) {
    if (!r) continue;
    orderedByIndex[r.idx] = {
      id: r.ev.id,
      fromMe: r.fromMe,
      text: r.text,
      createdAt: r.ev.created_at,
      wireKind: 4,
    };
  }
  for (const m of orderedByIndex) if (m !== null) decrypted.push(m);

  // NIP-17 — partner pubkey is hidden inside the encrypted rumor, so
  // we can't peer-scope at the relay. The encrypted DM store memoises
  // every wrap the inbox ever decrypted (#848), so serve THIS thread's
  // slice straight from the indexed (owner, conversation, created_at)
  // read — and if the store holds ANY wraps (an inbox-wide ingest has
  // run before), skip the expensive inbox-wide relay fetch entirely
  // (#190).
  //
  // Cold-store fallback: if the store has no wraps at all (first app
  // run post-login, or just-logged-out-logged-back-in) we still hit
  // the relay so the thread renders even before any refreshDmInbox has
  // fired. Subsequent opens short-circuit.
  //
  // Staleness tradeoff: a wrap that arrived in the last <30s and
  // hasn't been pulled by refreshDmInbox yet won't show until the
  // next tab focus. For a chat UX that's a non-issue.
  let skippedInboxFetch = false;
  try {
    const threadRows = await getConversationMessages(pubkey, normalized, { limit: DM_CONV_CAP });
    for (const r of threadRows) {
      if (r.wireKind === 4) nip04CacheHits++;
      else nip17CacheHits++;
      decrypted.push({
        id: r.eventId,
        fromMe: r.fromMe,
        text: r.content,
        createdAt: r.createdAt,
        wireKind: r.wireKind,
      });
    }
    skippedInboxFetch = await hasStoredWraps(pubkey);
  } catch (e) {
    // Store unavailable — fall back to the relay path below.
    if (__DEV__) console.warn('[DmStore] thread slice read failed:', e);
  }
  // Aborted mid-fetch (back-press during the kind-4 decrypt) — skip the
  // inbox-wide wrap fetch entirely and return what the store already gave us
  // (#868). The store rows above are already pushed into `decrypted`.
  const skipWrapFetch = skippedInboxFetch || (signal?.aborted ?? false);
  const inboxLastSeenForWraps = skipWrapFetch
    ? undefined
    : await loadLastSeen(inboxLastSeenKey(pubkey));
  const { kind1059 } = skipWrapFetch
    ? {
        kind1059: [] as Awaited<ReturnType<typeof nostrService.fetchInboxDmEvents>>['kind1059'],
      }
    : await nostrService.fetchInboxDmEvents(pubkey, readRelays, {
        since: inboxLastSeenForWraps,
      });
  if (
    kind1059.length > 0 &&
    (signerType === 'nsec' || signerType === 'amber' || signerType === 'nip46')
  ) {
    const onSkip = (reason: string, wrapId: string) => {
      if (__DEV__) console.warn(`[Nostr] NIP-17 thread unwrap skip (${wrapId}): ${reason}`);
    };
    let unwrap: ((wrap: (typeof kind1059)[0]) => Promise<DecodedRumor | null> | DecodedRumor | null) | null = null; // prettier-ignore
    if (signerType === 'nsec') {
      const secretKey = await getMemoisedSecretKey(pubkey);
      if (secretKey) unwrap = (wrap) => unwrapWrapNsec(wrap, secretKey, onSkip);
    } else if (signerType === 'amber') {
      // Thread view falls back to the Intent dialog if the silent path
      // rejects — the user has actively opened this thread, one approval
      // prompt per wrap is fine. Inbox refresh uses the silent-only path to
      // avoid the flood; stored rows cover the hot path.
      unwrap = (wrap) =>
        unwrapWrapViaNip44(wrap, (ct, cp) => amberService.requestNip44Decrypt(ct, cp, pubkey), onSkip); // prettier-ignore
    } else {
      // NIP-46 thread view: one bunker round-trip per wrap. Same as the
      // Amber fallback — the user has actively opened this thread, so a
      // per-wrap decrypt is acceptable; cache hits short-circuit.
      unwrap = (wrap) =>
        unwrapWrapViaNip44(wrap, (ct, cp) => nostrConnectService.requestNip44Decrypt(ct, cp, pubkey), onSkip); // prettier-ignore
    }
    if (unwrap) {
      // Same decrypt-once engine as refreshDmInbox (#848): DB known-id gate,
      // group routing, batched upsert. Differences preserved from the old
      // thread loop: every successfully decrypted 1:1 rumor is stored even if
      // it belongs to a different thread or a non-followed sender (the user
      // explicitly opened a conversation; inbox surfaces stay follow-gated at
      // read time), and the #743 skip-set is neither consulted nor written.
      const r = await ingestInboxWraps({
        owner: pubkey,
        wraps: kind1059,
        unwrap,
        passesFollowGate: () => true,
        onSkip,
        signal,
      });
      nip17CacheHits += r.alreadyKnown;
      nip17FreshDecrypts += r.misses;
      // Render-side filter to this thread's partner only — the rest were
      // stored for later opens of their own threads.
      for (const e of r.entries) {
        if (e.partnerPubkey !== normalized) continue;
        decrypted.push({
          id: e.id,
          fromMe: e.fromMe,
          text: e.text,
          createdAt: e.createdAt,
          wireKind: e.wireKind,
          rumorId: e.rumorId,
        });
      }
    }
  }

  // PR B: merge fresh decrypt results with what we had cached
  // from previous opens. Fresh takes precedence via `mergeConversationMessages`
  // Map semantics so re-ordered or edited events (rare) land right.
  const merged = mergeConversationMessages(cachedConv, decrypted, DM_CONV_CAP);

  // Aborted mid-fetch (Copilot #869): the kind-4 decrypt loop bails between
  // batches, so `decrypted` may omit events the abort skipped — but
  // `kind4Events` still holds them all. Persisting `convLastSeen` from the full
  // `kind4Events` set would advance the per-peer `since` cursor PAST those
  // never-decrypted events, permanently skipping them on the next open. Return
  // the store-backed `merged` (already painted) WITHOUT any cache/cursor write,
  // so an aborted run has no durable side effects.
  if (signal?.aborted) return merged;

  // Single-line perf summary — grep `[Perf] fetchConversation` out
  // of logcat to compare cold-store vs warm-store thread opens.
  // Cold store shows `hits=0, fresh=N` — whole inbox decrypted.
  // Warm store shows `hits≈N, fresh=0` — all store short-circuits.
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
