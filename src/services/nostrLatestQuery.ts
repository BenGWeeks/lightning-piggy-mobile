import type { Filter } from 'nostr-tools/filter';
import { pool, trackRelays } from './nostrPool';

/** Return the first matching value, absorb newer responses from remaining
 * relays until EOSE or the deadline, then report the newest value once. */
export async function fetchSingleLatest<T>(
  filter: Filter,
  relays: string[],
  parse: (tags: string[][], createdAt: number) => T,
  opts: { softTimeoutMs?: number; keepOpenMs?: number; onLatest?: (parsed: T) => void } = {},
): Promise<T | null> {
  trackRelays(relays);
  const softTimeoutMs = opts.softTimeoutMs ?? 5000;
  return new Promise<T | null>((resolve, reject) => {
    let firstResolved = false;
    let firstResolvedCreatedAt: number | null = null;
    let best: { tags: string[][]; created_at: number } | null = null;
    let closed = false;
    let sub: { close(): void } | undefined;
    const finish = (error?: unknown) => {
      if (closed) return;
      closed = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      try {
        if (error) reject(error);
        else {
          if (!firstResolved) resolve(best ? parse(best.tags, best.created_at) : null);
          if (
            opts.onLatest &&
            best &&
            (firstResolvedCreatedAt === null || best.created_at > firstResolvedCreatedAt)
          ) {
            const latest = parse(best.tags, best.created_at);
            // A task (not a microtask) lets async wrappers and the awaiting
            // caller persist the first result before we overwrite it.
            setTimeout(() => {
              try {
                opts.onLatest?.(latest);
              } catch (e) {
                reject(e);
              }
            }, 0);
          }
        }
      } catch (e) {
        reject(e);
      } finally {
        sub?.close();
      }
    };
    const softTimer = setTimeout(() => {
      if (!firstResolved) {
        firstResolved = true;
        resolve(null);
      }
    }, softTimeoutMs);
    const hardTimer = setTimeout(finish, softTimeoutMs + (opts.keepOpenMs ?? 3000));
    try {
      sub = pool.subscribeManyEose(relays, filter, {
        maxWait: softTimeoutMs + (opts.keepOpenMs ?? 3000),
        onclose: () => finish(),
        onevent: (event) => {
          if (closed || (best && event.created_at <= best.created_at)) return;
          best = event;
          if (!firstResolved) {
            try {
              const value = parse(event.tags, event.created_at);
              firstResolved = true;
              firstResolvedCreatedAt = event.created_at;
              resolve(value);
            } catch (e) {
              finish(e);
            }
          }
        },
      });
      if (closed) sub.close();
    } catch (e) {
      finish(e);
    }
  });
}
