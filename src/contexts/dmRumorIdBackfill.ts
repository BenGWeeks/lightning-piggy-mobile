import { selectRowsMissingRumorId, setDmRumorIds } from '../services/dmDb';
import { pool } from '../services/nostrPool';
import { querySyncAbortable } from '../services/relayQuery';
import type { RawGiftWrapEvent } from '../services/nostrService';
import { rumorEventId, type DecodedRumor } from '../utils/nip17Unwrap';
import { createYieldScheduler } from './nostrDecryptPacing';

/** Most rows one thread open backfills. Newest first, so the visible ones go first. */
export const RUMOR_ID_BACKFILL_CAP = 100;

// Wraps already asked for this session, by owner. One no relay still holds
// would otherwise be fetched again on every open of its thread.
const requested = new Map<string, Set<string>>();

/**
 * Gift wraps by event id. A wrap id is public (it's the outer event, already
 * addressed to us), so this reveals nothing a relay doesn't know.
 */
export async function fetchWrapsByIds(
  ids: string[],
  relays: string[],
  signal?: AbortSignal,
): Promise<RawGiftWrapEvent[]> {
  if (ids.length === 0 || relays.length === 0) return [];
  const events = await querySyncAbortable(
    pool,
    relays,
    { kinds: [1059], ids, limit: ids.length },
    { maxWait: 4000, signal },
  );
  return events as RawGiftWrapEvent[];
}

/**
 * Fill in the rumor id (#1320) on a thread's NIP-17 rows stored before
 * received rows carried one. Without it an old message can't be reacted to,
 * and a peer's reaction to it can't be matched.
 *
 * Wraps the thread open already fetched are reused; the rest of the missing
 * rows' wraps are fetched by id (`fetchWraps`). At most
 * {@link RUMOR_ID_BACKFILL_CAP} rows, yielding between decrypts. A wrap that
 * is gone or no longer decrypts is skipped. Returns the ids it filled, by
 * wrap id.
 */
export async function backfillThreadRumorIds(params: {
  owner: string;
  conversation: string;
  wraps: readonly RawGiftWrapEvent[];
  fetchWraps?: (ids: string[]) => Promise<RawGiftWrapEvent[]>;
  unwrap: (wrap: RawGiftWrapEvent) => Promise<DecodedRumor | null> | DecodedRumor | null;
  signal?: AbortSignal;
}): Promise<Map<string, string>> {
  const { owner, conversation, unwrap, signal } = params;
  const filled = new Map<string, string>();
  const missing = new Set(
    await selectRowsMissingRumorId(owner, conversation, RUMOR_ID_BACKFILL_CAP),
  );
  if (missing.size === 0) return filled;
  const wraps = params.wraps.filter((w) => missing.has(w.id));
  const fetched = new Set(wraps.map((w) => w.id));
  const asked = requested.get(owner) ?? new Set<string>();
  requested.set(owner, asked);
  const toFetch = [...missing].filter((id) => !fetched.has(id) && !asked.has(id));
  if (toFetch.length > 0 && params.fetchWraps && !signal?.aborted) {
    for (const id of toFetch) asked.add(id);
    const more = await params.fetchWraps(toFetch).catch(() => {
      // A failed read (offline, every relay down) can be retried later.
      for (const id of toFetch) asked.delete(id);
      return [] as RawGiftWrapEvent[];
    });
    for (const w of more) {
      if (missing.has(w.id) && !fetched.has(w.id)) {
        fetched.add(w.id);
        wraps.push(w);
      }
    }
  }
  const sched = createYieldScheduler({ signal, safetyEvery: 8 });
  try {
    for (const wrap of wraps) {
      if (signal?.aborted) break;
      await sched.maybeYield();
      let rumor: DecodedRumor | null;
      try {
        rumor = await unwrap(wrap);
      } catch {
        continue;
      }
      if (!rumor) continue;
      try {
        filled.set(wrap.id, rumorEventId(rumor));
      } catch {
        // A malformed rumor stays without an id, as it would on first ingest.
      }
    }
  } finally {
    sched.dispose();
  }
  if (!signal?.aborted) await setDmRumorIds(owner, filled);
  return signal?.aborted ? new Map() : filled;
}

export function __resetRumorIdBackfillForTests(): void {
  requested.clear();
}
