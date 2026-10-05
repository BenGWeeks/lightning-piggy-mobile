import type { Event, Filter } from 'nostr-tools';
import { fetchSingleLatest } from './nostrService';
import { pool, trackRelays } from './nostrPool';
import { dmInboxRelaysFromTags, RELAY_LIST_INDEXERS } from '../utils/relayListEvents';

export interface RelayPublishResult {
  url: string;
  ok: boolean;
  /** Relay's reason on rejection (e.g. "rate-limited: …"), or "timed out". */
  message?: string;
}

/** The user's published NIP-17 DM inbox relays (kind 10050), or null if none/unreachable. */
export async function fetchDmInboxRelays(
  pubkey: string,
  relays: string[],
  opts?: { onLatest?: (list: string[]) => void },
): Promise<string[] | null> {
  try {
    return await fetchSingleLatest<string[]>(
      { kinds: [10050], authors: [pubkey] } as Filter,
      [...new Set([...relays, ...RELAY_LIST_INDEXERS])],
      dmInboxRelaysFromTags,
      { onLatest: opts?.onLatest },
    );
  } catch {
    return null;
  }
}

/**
 * The NEWEST version of a replaceable list, not merely the first relay's reply:
 * `fetchSingleLatest` resolves on the first event and reports a strictly newer
 * one via `onLatest` when its ~3 s keep-open window closes, so wait that out.
 * Use before letting the user edit — a stale baseline would overwrite a newer
 * list set in another client.
 */
export async function fetchNewest<T>(
  start: (onLatest: (value: T) => void) => Promise<T | null>,
  windowMs = 3_500,
): Promise<T | null> {
  let newer: T | null = null;
  const first = await start((value) => {
    newer = value;
  });
  if (first === null) return null;
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  return newer ?? first;
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
        (): RelayPublishResult => ({ url, ok: true }),
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
