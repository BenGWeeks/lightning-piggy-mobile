import type { Event, Filter } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { isConnectionFailure } from './nostrDmPublish';

export interface RelayPublishResult {
  url: string;
  ok: boolean;
  /** Relay's reason on rejection (e.g. "rate-limited: …"), or "timed out". */
  message?: string;
}

/**
 * The NEWEST version of a replaceable event (e.g. kind 10002 / 10050) across
 * relays: collect every relay's reply until each finishes (EOSE) or `maxWaitMs`,
 * then pick the latest by created_at (ties: lowest id, per NIP-01). Unlike a
 * first-reply fetch, a fast relay holding an old copy can't win — needed
 * before letting the user edit and republish a list.
 */
export async function fetchLatestReplaceable(
  pubkey: string,
  kind: number,
  relays: string[],
  maxWaitMs = 6_000,
): Promise<Event | null> {
  trackRelays(relays);
  try {
    const events = await pool.querySync(relays, { kinds: [kind], authors: [pubkey] } as Filter, {
      maxWait: maxWaitMs,
    });
    let best: Event | null = null;
    for (const e of events) {
      if (e.pubkey !== pubkey || e.kind !== kind) continue;
      if (
        !best ||
        e.created_at > best.created_at ||
        (e.created_at === best.created_at && e.id < best.id)
      )
        best = e;
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Publish an already-signed replaceable event to each relay and report, per
 * relay, whether it was accepted — so the UI can say exactly where the update
 * landed (some relays rate-limit, require payment or silently drop writes).
 */
export async function publishToRelays(
  event: Event,
  relays: string[],
  timeoutMs = 8_000,
): Promise<RelayPublishResult[]> {
  trackRelays(relays);
  const attempts = pool.publish(relays, event);
  return Promise.all(
    relays.map(async (url, i): Promise<RelayPublishResult> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<RelayPublishResult>((resolve) => {
        timer = setTimeout(() => resolve({ url, ok: false, message: 'timed out' }), timeoutMs);
      });
      const attempt = Promise.resolve(attempts[i]).then(
        // nostr-tools RESOLVES (not rejects) with "connection failure: …" when
        // it can't reach the relay — that's a failure, never an accept.
        (value: unknown): RelayPublishResult =>
          isConnectionFailure(value) ? { url, ok: false, message: value } : { url, ok: true },
        (e: unknown): RelayPublishResult => ({
          url,
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      try {
        return await Promise.race([attempt, timeout]);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
