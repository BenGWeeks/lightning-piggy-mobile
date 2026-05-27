import { selectKnownEventIds, upsertDmMessages, type DmMessageRow } from './dmDb';

// Decrypt-once ingest for NIP-17 gift wraps (#695). This is the heart of the
// Messages-tab freeze fix: instead of re-walking and re-decrypting the whole
// inbox on every refresh (52s / 49s JS-thread block, measured 2026-05-26), we
// decrypt ONLY wraps whose id isn't already in the encrypted DB, persist them,
// and let the UI read indexed rows via dmDb.
//
// The caller (NostrContext) supplies the unwrap function — nsec or Amber/NIP-44
// — that turns one wrap into a storable row; this module owns the dedup gate,
// the batched upsert, and the cooperative yield so a big first-sync never
// blocks the JS thread in one unbroken span.

/** Minimal shape we need off a fetched kind-1059 wrap: just its event id. */
export interface IngestableWrap {
  id: string;
}

/**
 * Decrypt one wrap into a row to persist, or null to skip it (undecryptable,
 * not-for-us, filtered). Throwing is treated as a skip by the caller's own
 * onSkip handling — keep that contract in the supplied function.
 */
export type WrapDecryptor<W extends IngestableWrap> = (wrap: W) => Promise<DmMessageRow | null>;

export interface IngestResult {
  /** Wraps newly decrypted + stored this run. */
  ingested: number;
  /** Wraps skipped because their id was already stored (the decrypt-once win). */
  alreadyKnown: number;
  /** Wraps the decryptor returned null for (undecryptable / not-for-us). */
  undecryptable: number;
}

export interface IngestOptions {
  /**
   * Yield to the JS thread (via a 0ms timer) after every N *fresh* decrypts so
   * a large first-sync stays interactive instead of freezing in one block.
   * Cache-hit wraps are skipped cheaply and don't count toward the gap.
   */
  yieldEvery?: number;
  /** Progress callback after each yield — for a "setting up messages…" hint. */
  onProgress?: (decrypted: number, freshTotal: number) => void;
  /** Abort cooperatively (e.g. signer/identity changed mid-refresh). */
  signal?: { aborted: boolean };
}

const DEFAULT_YIELD_EVERY = 25;
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Ingest fetched wraps decrypt-once. Returns counts; the decrypted rows are
 * persisted to the encrypted DB (read them back via dmDb's indexed queries).
 */
export async function ingestWraps<W extends IngestableWrap>(
  wraps: readonly W[],
  decrypt: WrapDecryptor<W>,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, alreadyKnown: 0, undecryptable: 0 };
  if (wraps.length === 0) return result;

  // The decrypt-once gate: one indexed query tells us which wrap ids we've
  // already stored, so we never re-run the expensive unwrap for them.
  const known = await selectKnownEventIds(wraps.map((w) => w.id));

  const yieldEvery = options.yieldEvery ?? DEFAULT_YIELD_EVERY;
  const freshTotal = wraps.length - known.size;
  const fresh: DmMessageRow[] = [];
  let freshAttempts = 0; // wraps we actually ran the decryptor on (hit or null)
  for (const wrap of wraps) {
    if (options.signal?.aborted) break;
    if (known.has(wrap.id)) {
      result.alreadyKnown++;
      continue;
    }
    // A throwing decryptor is treated as a skip (per WrapDecryptor's contract)
    // so one undecryptable wrap can't abort the whole sync mid-way.
    let row: DmMessageRow | null = null;
    try {
      row = await decrypt(wrap);
    } catch {
      row = null;
    }
    if (row) fresh.push(row);
    else result.undecryptable++;
    freshAttempts++;
    // Yield only on fresh decrypts — that's where the CPU goes; cache-hit
    // wraps above are a cheap Set lookup and shouldn't pace the loop.
    if (yieldEvery > 0 && freshAttempts % yieldEvery === 0) {
      await yieldToEventLoop();
      options.onProgress?.(fresh.length, freshTotal);
    }
  }

  // Only count + report as ingested what we actually persist. An aborted run
  // skips the upsert, so its partial decrypts don't show as stored.
  if (fresh.length > 0 && !options.signal?.aborted) {
    await upsertDmMessages(fresh);
    result.ingested = fresh.length;
  }
  return result;
}
