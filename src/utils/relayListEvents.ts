import type { RelayConfig } from '../types/nostr';

/** Relay-list indexers most clients consult when looking up someone's relays. */
export const RELAY_LIST_INDEXERS = ['wss://purplepag.es', 'wss://user.kindpag.es'];

export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

const norm = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * A published relay list must be reachable by everyone: wss:// only, with a
 * real host. (A `ws://localhost` entry is how a test account once ended up
 * advertising an unreachable relay to the whole network.)
 */
export function isPublishableRelayUrl(url: string): boolean {
  try {
    const u = new URL(norm(url));
    const host = u.hostname;
    return (
      u.protocol === 'wss:' &&
      !!host &&
      host !== 'localhost' &&
      !host.endsWith('.local') &&
      !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    );
  } catch {
    return false;
  }
}

/** NIP-65 kind 10002: `["r", url]` (read+write) / `["r", url, "read"|"write"]`. */
export function buildRelayListEvent(relays: RelayConfig[], now = Date.now()): UnsignedEvent {
  const seen = new Set<string>();
  const tags: string[][] = [];
  for (const r of relays) {
    const url = norm(r.url);
    if (seen.has(url) || !isPublishableRelayUrl(url) || (!r.read && !r.write)) continue;
    seen.add(url);
    tags.push(r.read && r.write ? ['r', url] : ['r', url, r.read ? 'read' : 'write']);
  }
  return { kind: 10002, created_at: Math.floor(now / 1000), tags, content: '' };
}

/** NIP-17 kind 10050: the relays where the user receives DMs (`["relay", url]`). */
export function buildDmInboxEvent(urls: string[], now = Date.now()): UnsignedEvent {
  const tags = [...new Set(urls.map(norm))]
    .filter(isPublishableRelayUrl)
    .map((url) => ['relay', url]);
  return { kind: 10050, created_at: Math.floor(now / 1000), tags, content: '' };
}

/** Relay URLs from a kind-10050 event's `relay` tags. */
export function dmInboxRelaysFromTags(tags: string[][]): string[] {
  return tags.filter((t) => t[0] === 'relay' && t[1]).map((t) => norm(t[1]));
}

/**
 * Where to publish an updated list: everywhere the old list could be read
 * from (so it gets replaced there), the new list's relays, and the indexers.
 */
export function relayListPublishTargets(previous: string[], next: string[]): string[] {
  return [...new Set([...previous, ...next, ...RELAY_LIST_INDEXERS].map(norm))].filter(
    isPublishableRelayUrl,
  );
}
