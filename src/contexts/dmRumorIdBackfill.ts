import { selectRowsMissingRumorId, setDmRumorIds } from '../services/dmDb';
import type { RawGiftWrapEvent } from '../services/nostrService';
import { rumorEventId, type DecodedRumor } from '../utils/nip17Unwrap';
import { createYieldScheduler } from './nostrDecryptPacing';

/** Most rows one thread open backfills. Newest first, so the visible ones go first. */
export const RUMOR_ID_BACKFILL_CAP = 100;

/**
 * Fill in the rumor id (#1320) on a thread's NIP-17 rows stored before
 * received rows carried one. Without it an old message can't be reacted to,
 * and a peer's reaction to it can't be matched.
 *
 * Only wraps the thread open already fetched are decrypted (no extra relay
 * read), at most {@link RUMOR_ID_BACKFILL_CAP}, yielding between them. A wrap
 * that no longer decrypts is skipped. Returns the ids it filled, by wrap id.
 */
export async function backfillThreadRumorIds(params: {
  owner: string;
  conversation: string;
  wraps: readonly RawGiftWrapEvent[];
  unwrap: (wrap: RawGiftWrapEvent) => Promise<DecodedRumor | null> | DecodedRumor | null;
  signal?: AbortSignal;
}): Promise<Map<string, string>> {
  const { owner, conversation, wraps, unwrap, signal } = params;
  const filled = new Map<string, string>();
  if (wraps.length === 0) return filled;
  const missing = new Set(
    await selectRowsMissingRumorId(owner, conversation, RUMOR_ID_BACKFILL_CAP),
  );
  if (missing.size === 0) return filled;
  const sched = createYieldScheduler({ signal, safetyEvery: 8 });
  try {
    for (const wrap of wraps) {
      if (signal?.aborted) break;
      if (!missing.has(wrap.id)) continue;
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
