// Delivers a registration gift wrap to the notification watcher: to the relays
// in its kind-10050 inbox list (PROTOCOL.md), falling back to its defaults.

import type { NostrEvent } from 'nostr-tools/pure';

import { dmInboxRelaysFromTags, isRelayUrl } from '../utils/relayListEvents';
import { pool, trackRelays } from './nostrPool';
import { WATCHER_DEFAULT_RELAYS, WATCHER_PUBKEY } from './watcherRegistration';

const LOOKUP_MAX_WAIT_MS = 6_000;
const PUBLISH_TIMEOUT_MS = 10_000;
const INBOX_TTL_MS = 6 * 3600_000;
/** relay.damus.io requires NIP-42 AUTH and rate-limits: only use it when the
 * watcher lists nothing else. */
const AUTH_GATED = new Set(['wss://relay.damus.io']);

/** Lowercase scheme + host only — a relay path is case-sensitive. */
function strip(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.trim();
  }
}

/** Where to send: the inbox list without auth-gated relays, unless that
 * leaves nothing. */
export function watcherPublishTargets(inbox: string[]): string[] {
  const listed = [...new Set(inbox.map(strip).filter(isRelayUrl))];
  const base = listed.length > 0 ? listed : WATCHER_DEFAULT_RELAYS;
  const open = base.filter((r) => !AUTH_GATED.has(r));
  return open.length > 0 ? open : base;
}

let inboxCache: { relays: string[]; at: number } | null = null;

async function watcherInbox(): Promise<string[]> {
  if (inboxCache && Date.now() - inboxCache.at < INBOX_TTL_MS) return inboxCache.relays;
  try {
    const events = await pool.querySync(
      WATCHER_DEFAULT_RELAYS,
      { kinds: [10050], authors: [WATCHER_PUBKEY], limit: 1 },
      { maxWait: LOOKUP_MAX_WAIT_MS },
    );
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    const relays = latest ? dmInboxRelaysFromTags(latest.tags) : [];
    if (relays.length > 0) inboxCache = { relays, at: Date.now() };
    return relays;
  } catch {
    return [];
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

/** Publish `wrap` to the watcher; true when at least one relay accepted it.
 * The watcher never replies (a reply would itself be a push). */
export async function publishToWatcher(
  wrap: NostrEvent,
  stillValid: () => boolean = () => true,
): Promise<boolean> {
  const targets = watcherPublishTargets(await watcherInbox());
  // The lookup took a moment: the caller may no longer want this sent.
  if (!stillValid()) return false;
  trackRelays(targets);
  const settled = await Promise.allSettled(
    pool.publish(targets, wrap).map((p) => withTimeout(p, PUBLISH_TIMEOUT_MS)),
  );
  return settled.some((r) => r.status === 'fulfilled');
}

/** Test seam. */
export function __resetWatcherTransportForTests(): void {
  inboxCache = null;
}
