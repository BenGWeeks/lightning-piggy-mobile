import type { DmInboxEntry } from '../utils/conversationSummaries';
import {
  partnerFromRumor,
  textForRumor,
  rumorEventId,
  type DecodedRumor,
} from '../utils/nip17Unwrap';
import { ingestWraps, type IngestableWrap } from '../services/dmIngest';
import type { DmMessageRow } from '../services/dmDb';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { createYieldScheduler, NIP17_LOOP_YIELD_EVERY } from './nostrDecryptPacing';
import { loadNip17SkipSet, writeNip17SkipSet } from './nostrDmCache';

// The one NIP-17 inbox-wrap ingest engine (#848). Both refreshDmInbox signer
// branches (nsec + Amber) and the cold thread-open path in
// nostrFetchConversation used to carry near-identical decrypt loops, each
// read-modify-writing the plaintext wrap-cache file. They now all run through
// here: dmIngest's decrypt-once gate (one indexed query against the encrypted
// DB) decides what to decrypt, the decryptor below applies the #743 skip-set
// and the group-route / follow-gate policy, and dmIngest batch-upserts the
// fresh rows into the encrypted DB. No plaintext touches a file anywhere in
// this path.

export interface InboxWrapIngestParams<W extends IngestableWrap> {
  /** Signed-in account pubkey — scopes the decrypt-once gate + stored rows. */
  owner: string;
  wraps: readonly W[];
  /** Signer-specific unwrap (nsec sync, Amber IPC). Throwing = skip the wrap. */
  unwrap: (wrap: W) => Promise<DecodedRumor | null> | DecodedRumor | null;
  /** The parental-control follow gate (B1). Pass `() => true` to store every
   * decrypted 1:1 rumor (the thread-open path, where the user explicitly
   * opened a conversation). */
  passesFollowGate: (pk: string) => boolean;
  /** Per-account skip-set file key (#743). Omit on the thread-open path,
   * which never consulted or wrote the skip-set. */
  skipKey?: string;
  /** User-intent refresh (#743/#846): re-evaluate skip-set wraps. */
  bypassSkipSet?: boolean;
  /** First refresh of the session — swaps RAF yields for macro-task yields
   * (#788) inside the pacing scheduler. */
  isColdStart?: boolean;
  signal?: AbortSignal;
  /** Amber inbox refresh: a PERMISSION_NOT_GRANTED from the silent decrypt
   * path stops further decrypt attempts (one flag, no per-wrap dialog flood)
   * instead of being treated as an ordinary skip. */
  stopOnPermissionDenied?: boolean;
  /** Dev breadcrumb for unwrap skips, matching the old per-branch onSkip. */
  onSkip?: (reason: string, wrapId: string) => void;
}

export interface InboxWrapIngestResult {
  /** Followed 1:1 entries newly decrypted this run (DB-known wraps are NOT
   * re-emitted — the caller merges `loadInboxEntries` for those). */
  entries: DmInboxEntry[];
  /** Wraps short-circuited by the encrypted DB's decrypt-once gate. */
  alreadyKnown: number;
  /** Wraps short-circuited by the #743 skip-set. */
  skipHits: number;
  /** Fresh decrypt attempts (cache + skip-set misses). */
  misses: number;
  /** Rows persisted to the encrypted DB this run. */
  stored: number;
  /** Pacing yields performed (perf log). */
  yields: number;
  permissionDenied: boolean;
}

const isPermissionNotGranted = (error: unknown): boolean => {
  const code = (error as { code?: string })?.code;
  const message = (error as Error)?.message ?? '';
  return code === 'PERMISSION_NOT_GRANTED' || /PERMISSION_NOT_GRANTED/.test(message);
};

/**
 * Decrypt-once ingest of kind-1059 inbox wraps into the encrypted DM store.
 * Order of gates per wrap: DB known-id (inside ingestWraps) → skip-set →
 * decrypt → group-route → follow-gate. Group-routed and non-followed rumors
 * are added to the skip-set exactly as before (#743). An aborted run PERSISTS
 * the DM rows it already decrypted (idempotent + owner-keyed, so a cut-short
 * post-login rebuild isn't wasted — F1/#849), but suppresses skip-set growth
 * and emitted entries (partial session state #412 intentionally drops).
 */
export async function ingestInboxWraps<W extends IngestableWrap>(
  params: InboxWrapIngestParams<W>,
): Promise<InboxWrapIngestResult> {
  const { owner, wraps, unwrap, passesFollowGate, skipKey, signal } = params;
  const entries: DmInboxEntry[] = [];
  let skipHits = 0;
  let misses = 0;
  let permissionDenied = false;
  let skipSetDirty = false;
  const skipSet = skipKey ? await loadNip17SkipSet(skipKey) : new Set<string>();
  // Frame-budget pacing (#532) + cold-start macro-task yields (#788). Runs
  // inside the decryptor so only fresh decrypts pay for yields — DB-known
  // wraps are a Set lookup in ingestWraps and need no pacing.
  const sched = createYieldScheduler({
    signal,
    safetyEvery: NIP17_LOOP_YIELD_EVERY,
    coldStart: params.isColdStart === true,
  });

  let ingestResult = { ingested: 0, alreadyKnown: 0, undecryptable: 0 };
  try {
    ingestResult = await ingestWraps(
      owner,
      wraps,
      async (wrap): Promise<DmMessageRow | null> => {
        await sched.maybeYield();
        if (signal?.aborted) return null;
        // Skip-set hit: previously decrypted, produced no inbox entry (group
        // rumor / non-followed sender) — short-circuit without re-paying the
        // schnorr + NIP-44 cost. Bypassed only on user-intent refreshes (#743).
        if (params.bypassSkipSet !== true && skipSet.has(wrap.id)) {
          skipHits++;
          return null;
        }
        // After an Amber permission denial, drain the remaining wraps without
        // further IPC attempts — they'd all fail the same way this refresh.
        if (permissionDenied) return null;
        misses++;
        let rumor: DecodedRumor | null;
        try {
          rumor = await unwrap(wrap);
        } catch (error) {
          if (params.stopOnPermissionDenied && isPermissionNotGranted(error)) {
            permissionDenied = true;
            if (__DEV__) {
              console.log('[Nostr] Amber NIP-44 permission not granted — stopping NIP-17 unwrap');
            }
            return null;
          }
          params.onSkip?.((error as Error)?.message ?? 'unwrap threw', wrap.id);
          return null;
        }
        if (!rumor) return null;
        // Multi-recipient (group) rumors: route to group storage and
        // short-circuit the DM path — the 1:1 inbox never sees them.
        const routeResult = await tryRouteGroupRumor(rumor, owner, wrap.id);
        if (routeResult.kind !== 'not-group') {
          if (skipKey) {
            skipSet.add(wrap.id);
            skipSetDirty = true;
          }
          return null;
        }
        const partnership = partnerFromRumor(rumor, owner);
        if (!partnership) return null;
        // B1 — drop non-follows at the data layer (parental control). A
        // successful decrypt with no stored row goes to the skip-set so the
        // next refresh doesn't re-pay it; pull-to-refresh (force) bypasses
        // the CHECK above so a newly-followed sender's wraps re-evaluate (#745).
        if (!passesFollowGate(partnership.partnerPubkey)) {
          if (skipKey) {
            skipSet.add(wrap.id);
            skipSetDirty = true;
          }
          return null;
        }
        const text = textForRumor(rumor);
        // Inner rumor id (#857) — the delivery-store key, stable across wraps
        // and matching the sender's send-time eventId. Computed only for our own
        // sent rows (fromMe); a received row never carries a delivery tick.
        const rumorId = partnership.fromMe ? rumorEventId(rumor) : undefined;
        entries.push({
          id: wrap.id,
          partnerPubkey: partnership.partnerPubkey,
          fromMe: partnership.fromMe,
          createdAt: rumor.created_at,
          text,
          wireKind: rumor.kind,
          rumorId,
        });
        return {
          owner,
          eventId: wrap.id,
          conversation: partnership.partnerPubkey,
          createdAt: rumor.created_at,
          sender: partnership.fromMe ? owner : partnership.partnerPubkey,
          content: text,
          fromMe: partnership.fromMe,
          wireKind: rumor.kind,
        };
      },
      // Pacing is the scheduler above; disable ingestWraps' count-based yield.
      { yieldEvery: 0, signal },
    );
  } finally {
    sched.dispose();
  }

  // Persist skip-set growth only for completed runs. The skip-set's invariant
  // is "entry ⇒ decrypt was paid AND produced no stored row"; an aborted run
  // only walked part of the wraps, so its partial skip-set is incomplete and
  // could mask a not-yet-evaluated followed sender on the retry. (DM rows DO
  // persist on abort — ingestWraps flushes them — but a stored row and a
  // skip-set entry are mutually exclusive per wrap, so there's no conflict.)
  if (skipSetDirty && skipKey && !signal?.aborted) {
    await writeNip17SkipSet(skipKey, skipSet);
  }

  return {
    entries: signal?.aborted ? [] : entries,
    alreadyKnown: ingestResult.alreadyKnown,
    skipHits,
    misses,
    stored: ingestResult.ingested,
    yields: sched.yieldCount,
    permissionDenied,
  };
}
