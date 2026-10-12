import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import * as storage from './zapSenderProfileStorage';

export interface MentionProfile {
  name: string | null;
  picture: string | null;
}
const EMPTY: MentionProfile = { name: null, picture: null };
const MAX_BATCH = 64;
const owners = new Map<string, Set<(profile: MentionProfile) => void>>();
const pending = new Set<string>();
const cache = new Map<string, { profile: MentionProfile; at: number }>();
let timer: ReturnType<typeof setTimeout> | undefined;
let active: { keys: string[]; controller: AbortController } | undefined;
let readRelays: string[] = [];

export function peekMentionProfile(pubkey: string): MentionProfile {
  const stored = storage.peekSync(pubkey);
  if (stored) return { name: stored.displayName ?? stored.name ?? null, picture: stored.picture };
  const hit = cache.get(pubkey);
  return hit && Date.now() - hit.at < 10 * 60 * 1000 ? hit.profile : EMPTY;
}

function schedule(): void {
  if (!timer && !active && pending.size) timer = setTimeout(() => void flush(), 60);
}

/** Each focused consumer owns its interest. The last blur aborts a running
 * batch; remaining consumers keep shared work alive. Cosmetic kind-0 fields
 * never enter the verified payment cache. */
export function subscribeMentionProfile(
  pubkey: string,
  relays: string[],
  receive: (profile: MentionProfile) => void,
): () => void {
  const listeners = owners.get(pubkey) ?? new Set();
  listeners.add(receive);
  owners.set(pubkey, listeners);
  readRelays = relays.slice(0, 6);
  const hit = peekMentionProfile(pubkey);
  if (hit !== EMPTY) receive(hit);
  else if (!active?.keys.includes(pubkey) || active.controller.signal.aborted) {
    pending.add(pubkey);
    schedule();
  }
  return () => {
    listeners.delete(receive);
    if (!listeners.size) {
      owners.delete(pubkey);
      pending.delete(pubkey);
    }
    if (active && active.keys.every((key) => !owners.has(key))) active.controller.abort();
    if (!pending.size && timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

async function flush(): Promise<void> {
  timer = undefined;
  const keys = [...pending].slice(0, MAX_BATCH);
  keys.forEach((key) => pending.delete(key));
  const batch = { keys, controller: new AbortController() };
  active = batch;
  const signal = batch.controller.signal;
  const resolved = new Map<string, MentionProfile>();
  const queried = new Set<string>();
  try {
    const stored = await storage.getMany(keys);
    if (signal.aborted) return;
    for (const [key, profile] of stored) {
      resolved.set(key, {
        name: profile.displayName ?? profile.name ?? null,
        picture: profile.picture,
      });
    }
    const missing = keys.filter((key) => !resolved.has(key) && owners.has(key));
    if (missing.length && readRelays.length) {
      missing.forEach((key) => queried.add(key));
      const relays = readRelays;
      trackRelays(relays);
      // kind-0 is structure-only in the shared pool. Display fields don't
      // need schnorr checks; payment fields are fetched on the profile page.
      const events = await querySyncAbortable(
        pool,
        relays,
        { kinds: [0], authors: missing, limit: missing.length * 2 },
        { signal, maxWait: 3000 },
      );
      const best = new Map<string, number>();
      for (const event of events) {
        if (signal.aborted) return;
        if (
          event.kind !== 0 ||
          !missing.includes(event.pubkey) ||
          event.content.length > 32768 ||
          event.created_at > Date.now() / 1000 + 300 ||
          event.created_at <= (best.get(event.pubkey) ?? -Infinity)
        )
          continue;
        try {
          const data = JSON.parse(event.content);
          const field = (value: unknown) => (typeof value === 'string' ? value : null);
          resolved.set(event.pubkey, {
            name: field(data.display_name) ?? field(data.name),
            picture: field(data.picture),
          });
          best.set(event.pubkey, event.created_at);
        } catch {
          /* Invalid cosmetic metadata. */
        }
      }
    }
    if (signal.aborted) return;
    for (const key of keys) {
      if (!resolved.has(key) && !queried.has(key)) {
        // A consumer can return after the relay filter was built. Its key
        // has not been queried, so a negative cache entry would be fabricated.
        if (owners.has(key) && readRelays.length) pending.add(key);
        continue;
      }
      const profile = resolved.get(key) ?? { ...EMPTY };
      cache.delete(key);
      cache.set(key, { profile, at: Date.now() });
      for (const receive of owners.get(key) ?? []) receive(profile);
    }
    while (cache.size > 300) cache.delete(cache.keys().next().value!);
  } catch {
    /* A later focus can retry a failed batch. */
  } finally {
    active = undefined;
    schedule();
  }
}

export function __resetMentionProfilesForTests(): void {
  active?.controller.abort();
  if (timer) clearTimeout(timer);
  timer = undefined;
  owners.clear();
  pending.clear();
  cache.clear();
  readRelays = [];
}
