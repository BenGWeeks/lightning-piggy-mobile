// Relay side of the friends-of-friends computation: fetch each friend's
// newest kind-3 follow list. This is the `fetchKind3` that
// `friendsOfFriendsService.computeFofSet` injects (the heuristics, caps and
// cache all live there) — keep it a plain "pubkey → follows" lookup.
//
// Perf (#1274 pattern): kind-3 events are large (hundreds of `p` tags) and a
// schnorr check costs ~25 ms on a phone, so the shared pool's eager per-event
// verification is avoided. Events arrive through the structure-only market
// pool, only the newest revision per friend is kept, and those winners are
// verified here in a budget-gated, yielded loop. A revision that fails is
// dropped (that friend contributes nothing) rather than trusted.
import type { Event } from 'nostr-tools';
import { acquireMarketListingsPool } from './marketListingsPool';
import { collectRelaySnapshot } from './relaySnapshot';
import { selectHealthyRelays } from './relayHealth';
import { verifyEventCached } from './nostrVerifyCache';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';

/** Contact-list indexers queried alongside the user's read relays. */
export const FOLLOW_LIST_RELAYS = [
  'wss://purplepag.es',
  'wss://user.kindpag.es',
  'wss://relay.primal.net',
];
/** Relays per batch (indexers first, then the user's read relays). */
export const MAX_FOLLOW_LIST_RELAYS = 6;
/** One batch's ceiling, and the time other relays get after the first answers. */
const BATCH_TIMEOUT_MS = 8000;
const GRACE_MS = 1500;
/** A contact list beyond this many tags is not a person's follow list. */
const MAX_TAGS = 5000;

const HEX64 = /^[0-9a-f]{64}$/;
const abortError = () =>
  Object.assign(new Error('Follow-list fetch aborted'), { name: 'AbortError' });
const normaliseRelay = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/** Indexers first, then the user's read relays — de-duplicated and capped. */
export function followListRelays(userRelays: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of [...FOLLOW_LIST_RELAYS, ...userRelays]) {
    const url = normaliseRelay(raw);
    if (/^wss:\/\/[^/\s]+/.test(url)) seen.add(url);
  }
  return [...seen].slice(0, MAX_FOLLOW_LIST_RELAYS);
}

/** Newest revision wins; on a timestamp tie the lowest id (replaceable-event rule). */
const supersedes = (next: Event, prev: Event | undefined) =>
  !prev ||
  next.created_at > prev.created_at ||
  (next.created_at === prev.created_at && next.id < prev.id);

/**
 * Fetch the newest verified kind-3 for each of `pubkeys` (one bounded batch —
 * `computeFofSet` already chunks the friend list). Returns lowercase-hex
 * follows per friend; friends with no (verifiable) contact list are absent.
 */
export async function fetchFollowLists(
  pubkeys: readonly string[],
  userRelays: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  const wanted = new Set(pubkeys.map((p) => p.toLowerCase()).filter((p) => HEX64.test(p)));
  const abort = signal ?? new AbortController().signal;
  const urls = selectHealthyRelays(followListRelays(userRelays));
  if (abort.aborted) throw abortError();
  if (wanted.size === 0) return {};
  if (urls.length === 0) throw new Error('No follow-list relays available');
  const latest = new Map<string, Event>();
  const lease = acquireMarketListingsPool(urls);
  try {
    const snapshot = await collectRelaySnapshot({
      urls,
      // Replaceable kind: one event per author, so the author count bounds it.
      filters: [{ kinds: [3], authors: [...wanted], limit: wanted.size }],
      maxConcurrentFilters: 1,
      signal: abort,
      deadline: Date.now() + BATCH_TIMEOUT_MS,
      graceMs: GRACE_MS,
      relayPool: lease.pool,
      onEvent: (event) => {
        if (event.kind !== 3 || !wanted.has(event.pubkey) || event.tags.length > MAX_TAGS) return;
        if (supersedes(event, latest.get(event.pubkey))) latest.set(event.pubkey, event);
      },
    });
    if (abort.aborted) throw abortError();
    if (snapshot.answered.length === 0) throw new Error('No follow-list relay answered');
  } finally {
    lease.release();
  }
  const out: Record<string, string[]> = {};
  const scheduler = createYieldScheduler({ signal: abort, safetyEvery: 8 });
  try {
    for (const [pubkey, event] of latest) {
      await scheduler.maybeYield();
      if (abort.aborted) break;
      if (!verifyEventCached(event)) continue;
      const follows: string[] = [];
      for (const tag of event.tags) {
        const pk = tag[0] === 'p' ? tag[1]?.toLowerCase() : undefined;
        if (pk && HEX64.test(pk)) follows.push(pk);
      }
      out[pubkey] = follows;
    }
  } finally {
    scheduler.dispose();
  }
  // A cut-short batch must not reach computeFofSet's cache as if complete.
  if (abort.aborted) throw abortError();
  return out;
}
