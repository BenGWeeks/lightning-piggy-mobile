import { Kind4RetryStore, isTransientKind4Error } from './kind4RetryStore';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import type { RawDmEvent } from '../services/nostrService';
import { nip04PlaintextCache } from './nostrSecretKeyCache';
import { createYieldScheduler, DECRYPT_YIELD_EVERY } from './nostrDecryptPacing';

/** Decrypt only inbox kind-4 cache misses; return partial rows on abort so
 * the caller can persist productive work before honoring a tab blur. */
export async function decryptInboxKind4(args: {
  owner: string;
  targets: { ev: RawDmEvent; fromMe: boolean; partnerPubkey: string }[];
  decrypt: (peer: string, ciphertext: string) => Promise<string | null>;
  signal?: AbortSignal;
  isColdStart: boolean;
  failures?: Kind4RetryStore;
  bypassFailures?: boolean;
}): Promise<{
  entries: DmInboxEntry[];
  rows: DmMessageRow[];
  attempts: number;
  processed: number;
}> {
  const entries: DmInboxEntry[] = [];
  const rows: DmMessageRow[] = [];
  let attempts = 0;
  let processed = 0;
  const scheduler = createYieldScheduler({
    signal: args.signal,
    safetyEvery: DECRYPT_YIELD_EVERY,
    coldStart: args.isColdStart,
  });
  try {
    for (let i = 0; i < args.targets.length; i += DECRYPT_YIELD_EVERY) {
      await scheduler.maybeYield();
      if (args.signal?.aborted) break;
      const batch = args.targets.slice(i, i + DECRYPT_YIELD_EVERY);
      const results = await Promise.all(
        batch.map(async (target) => {
          // Persisted backoff and permanent negatives avoid signer storms.
          // A user refresh retries them; aborted decrypts never enter this cache.
          if (args.failures?.shouldSkip(target.ev.id, args.bypassFailures)) {
            processed++;
            return null;
          }
          attempts++;
          let text: string | null = null;
          let counted = true;
          try {
            text = await args.decrypt(target.partnerPubkey, target.ev.content);
          } catch (error) {
            counted = !isTransientKind4Error(error);
          }
          processed++;
          if (text === null) {
            if (!args.signal?.aborted)
              args.failures?.failed(target.ev.id, target.ev.created_at, counted);
            return null;
          }
          args.failures?.succeeded(target.ev.id);
          if (!args.signal?.aborted) nip04PlaintextCache.set(target.ev.id, text);
          return { target, text };
        }),
      );
      for (const result of results) {
        if (!result) continue;
        const { target, text } = result;
        entries.push({
          id: target.ev.id,
          partnerPubkey: target.partnerPubkey,
          fromMe: target.fromMe,
          createdAt: target.ev.created_at,
          text,
          wireKind: 4,
        });
        rows.push({
          owner: args.owner,
          eventId: target.ev.id,
          conversation: target.partnerPubkey,
          createdAt: target.ev.created_at,
          sender: target.fromMe ? args.owner : target.partnerPubkey,
          content: text,
          fromMe: target.fromMe,
          wireKind: 4,
        });
      }
    }
  } finally {
    scheduler.dispose();
  }
  return { entries, rows, attempts, processed };
}

/** A failed write must not leave plaintext cache hits masquerading as stored rows. */
export async function persistInboxKind4(rows: DmMessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await upsertDmMessages(rows);
  } catch (error) {
    for (const row of rows) nip04PlaintextCache.delete(row.eventId);
    throw error;
  }
}
