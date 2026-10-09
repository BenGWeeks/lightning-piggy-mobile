// marmot-ts `NostrNetworkInterface` over the app's shared nostr-tools pool.
//
// Every relay call stays bounded (#perf rules): requests carry the library's
// own `limit`/`since`, and `request()` resolves on EOSE or `maxWait`.

import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

import { dmInboxRelaysFromTags, isRelayUrl } from '../utils/relayListEvents';
import { pool, trackRelays } from './nostrPool';
import { DEFAULT_RELAYS } from './nostrService';

const REQUEST_MAX_WAIT_MS = 6_000;
const PUBLISH_TIMEOUT_MS = 10_000;
const INBOX_CACHE_TTL_MS = 10 * 60_000;

const asArray = (f: Filter | Filter[]) => (Array.isArray(f) ? f : [f]);
const cleanRelays = (relays: string[]) => [...new Set(relays.filter(isRelayUrl))];
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

export function createMarmotNetwork(getFallbackRelays: () => string[]): NostrNetworkInterface {
  const relaysOr = (relays: string[]) => {
    const cleaned = cleanRelays(relays);
    return cleaned.length > 0 ? cleaned : cleanRelays([...getFallbackRelays(), ...DEFAULT_RELAYS]);
  };
  const inboxCache = new Map<string, { relays: string[]; at: number }>();

  return {
    async publish(relays, event) {
      const targets = relaysOr(relays);
      trackRelays(targets);
      const settled = await Promise.allSettled(
        pool.publish(targets, event as NostrEvent).map((p) => withTimeout(p, PUBLISH_TIMEOUT_MS)),
      );
      return Object.fromEntries(
        targets.map((url, i) => {
          const r = settled[i];
          return [
            url,
            r.status === 'fulfilled'
              ? { from: url, ok: true, message: r.value }
              : { from: url, ok: false, message: String(r.reason) },
          ];
        }),
      );
    },

    async request(relays, filters) {
      const targets = relaysOr(relays);
      trackRelays(targets);
      const batches = await Promise.all(
        asArray(filters as Filter | Filter[]).map((f) =>
          pool.querySync(targets, f, { maxWait: REQUEST_MAX_WAIT_MS }),
        ),
      );
      const byId = new Map<string, NostrEvent>();
      for (const e of batches.flat()) byId.set(e.id, e);
      return [...byId.values()];
    },

    subscription(relays, filters) {
      return {
        subscribe(observer) {
          const targets = relaysOr(relays);
          trackRelays(targets);
          const closers = asArray(filters as Filter | Filter[]).map((f) =>
            pool.subscribeMany(targets, f, {
              onevent: (e) => observer.next?.(e),
            }),
          );
          return { unsubscribe: () => closers.forEach((c) => c.close()) };
        },
      };
    },

    async getUserInboxRelays(pubkey) {
      const cached = inboxCache.get(pubkey);
      if (cached && Date.now() - cached.at < INBOX_CACHE_TTL_MS) return cached.relays;
      const lookup = relaysOr(getFallbackRelays());
      const events = await pool.querySync(
        lookup,
        { kinds: [10050], authors: [pubkey], limit: 1 },
        { maxWait: REQUEST_MAX_WAIT_MS },
      );
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      const relays = relaysOr(latest ? dmInboxRelaysFromTags(latest.tags) : []);
      inboxCache.set(pubkey, { relays, at: Date.now() });
      return relays;
    },
  };
}

/**
 * Strict relay access for MIP-05 push triggers: publish ONLY to the given
 * relays and read a server's inbox list without falling back to defaults —
 * the spec's publish targets are the records' relay hints, else the server's
 * own 10050 inbox; anywhere else would just leak the trigger.
 */
export interface PushTransport {
  publish(relays: string[], event: NostrEvent): Promise<void>;
  inboxRelays(pubkey: string): Promise<string[]>;
}

export function createPushTransport(getLookupRelays: () => string[]): PushTransport {
  return {
    async publish(relays, event) {
      const targets = cleanRelays(relays);
      if (targets.length === 0) return;
      trackRelays(targets);
      await Promise.allSettled(
        pool.publish(targets, event).map((p) => withTimeout(p, PUBLISH_TIMEOUT_MS)),
      );
    },
    async inboxRelays(pubkey) {
      const lookup = cleanRelays([...getLookupRelays(), ...DEFAULT_RELAYS]);
      const events = await pool.querySync(
        lookup,
        { kinds: [10050], authors: [pubkey], limit: 1 },
        { maxWait: REQUEST_MAX_WAIT_MS },
      );
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      return latest ? cleanRelays(dmInboxRelaysFromTags(latest.tags)) : [];
    },
  };
}
