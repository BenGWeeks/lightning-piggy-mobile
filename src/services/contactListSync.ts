import type { Filter } from 'nostr-tools/filter';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { pool, trackRelays } from './nostrPool';
import { isRelayFailureReason } from './relayQuery';
import { LP_CLIENT_TAG } from './nip89ClientTag';
import { tagsToContacts } from '../utils/contacts';
import { normalizePubkey } from '../utils/pubkey';
import type { NostrContact } from '../types/nostr';

/**
 * Safe read-modify-write for the user's kind-3 follow list (#1271).
 *
 * A kind-3 is a replaceable event: whatever we publish REPLACES the whole
 * list on every relay. Building it from the app's in-memory `contacts` meant
 * that if that copy hadn't loaded (or loaded partially), one Follow tap
 * published a list holding only that person and wiped the real one. So every
 * write now starts from the newest kind-3 on the user's relays, and refuses
 * to publish when it can't get one and the local copy is empty.
 */

/** The parts of a kind-3 that a follow/unfollow must carry forward. */
export interface ContactListBase {
  tags: string[][];
  /** Legacy relay-map JSON some clients keep in kind-3 `content`; preserved verbatim. */
  content: string;
  /** `created_at` of the event this came from (0 for a local-only base). */
  createdAt: number;
}

export type ContactListFetchResult =
  /** Newest signature-verified kind-3 from the relays. */
  | { status: 'found'; base: ContactListBase }
  /** Every relay that answered finished (EOSE) with no kind-3: the user has none. */
  | { status: 'none' }
  /** No relay answered in time, or all of them failed: we know nothing. */
  | { status: 'failed' };

export type ContactChange =
  | { type: 'follow'; pubkey: string; relay?: string | null; petname?: string | null }
  | { type: 'unfollow'; pubkey: string };

export const CONTACT_LIST_FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch the user's newest kind-3, bounded by `limit: 1` per relay and a
 * timeout. Only events that are authored by `pubkey` AND pass a full schnorr
 * check count. A forged list from a hostile relay would otherwise be signed
 * and republished as the user's own.
 */
export function fetchLatestContactList(
  pubkey: string,
  relays: string[],
  timeoutMs: number = CONTACT_LIST_FETCH_TIMEOUT_MS,
): Promise<ContactListFetchResult> {
  const author = pubkey.toLowerCase();
  const urls = [...new Set(relays)];
  if (urls.length === 0) return Promise.resolve({ status: 'failed' });
  trackRelays(urls);
  return new Promise((resolve) => {
    let best: NostrEvent | null = null;
    let settled = false;
    let sub: { close: () => void } | null = null;
    const finish = (outcome: 'eose' | 'failed') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sub?.close();
      } catch {
        // already closing
      }
      if (best) {
        resolve({
          status: 'found',
          base: { tags: best.tags, content: best.content, createdAt: best.created_at },
        });
      } else {
        resolve({ status: outcome === 'eose' ? 'none' : 'failed' });
      }
    };
    const timer = setTimeout(() => finish('failed'), timeoutMs);
    try {
      sub = pool.subscribeMany(urls, { kinds: [3], authors: [author], limit: 1 } as Filter, {
        maxWait: timeoutMs + 1000,
        onevent(event: NostrEvent) {
          if (event.kind !== 3 || event.pubkey.toLowerCase() !== author) return;
          if (best && event.created_at <= best.created_at) return;
          if (!verifyEvent(event)) return;
          best = event;
        },
        oneose() {
          // nostr-tools emits aggregate EOSE right before aggregate close when
          // every relay FAILED; let onclose classify that first.
          queueMicrotask(() => finish('eose'));
        },
        onclose(reasons: (string | { url: string; reason: string })[]) {
          const allFailed = reasons.length > 0 && reasons.every(isRelayFailureReason);
          finish(allFailed ? 'failed' : 'eose');
        },
      });
    } catch {
      finish('failed');
    }
    if (settled) {
      try {
        sub?.close();
      } catch {
        // already closed
      }
    }
  });
}

/** A base built from the app's local list, used only when relays hold no kind-3 or can't be reached. */
export function localContactListBase(contacts: readonly NostrContact[]): ContactListBase {
  return {
    tags: contacts.map((c) => ['p', c.pubkey, c.relay || '', c.petname || '']),
    content: '',
    createdAt: 0,
  };
}

/**
 * Pick what a follow/unfollow is applied to, or `null` to refuse publishing:
 * - relays returned a kind-3 → that (the local copy may be stale or unloaded);
 * - relays confirmed there is none → the local list (empty for a brand-new
 *   user, so their first follow still works);
 * - relays failed → the local list only if it has entries. An empty local
 *   copy here is indistinguishable from "never loaded", and publishing it
 *   would wipe the real list.
 */
export function resolveContactListBase(
  fetched: ContactListFetchResult,
  localContacts: readonly NostrContact[],
): ContactListBase | null {
  if (fetched.status === 'found') return fetched.base;
  if (fetched.status === 'none') return localContactListBase(localContacts);
  return localContacts.length > 0 ? localContactListBase(localContacts) : null;
}

const isClientTag = (tag: string[]) => tag[0] === 'client';

/**
 * Apply one follow/unfollow to `base`. Every other tag (other follows, `t`
 * hashtags, `a` / `e` tags…) and the `content` are kept in order; only the
 * NIP-89 client tag is replaced with ours. `created_at` is bumped past the
 * base's so relays never treat the new list as older than the one it edits.
 */
export function applyContactChange(
  base: ContactListBase,
  change: ContactChange,
  nowSec: number = Math.floor(Date.now() / 1000),
): { kind: 3; created_at: number; tags: string[][]; content: string } {
  const target = normalizePubkey(change.pubkey) ?? change.pubkey.toLowerCase();
  const isTarget = (tag: string[]) =>
    tag[0] === 'p' && typeof tag[1] === 'string' && tag[1].toLowerCase() === target;
  let tags = base.tags.filter((tag) => !isClientTag(tag));
  if (change.type === 'unfollow') {
    tags = tags.filter((tag) => !isTarget(tag));
  } else if (!tags.some(isTarget)) {
    tags = [...tags, ['p', target, change.relay || '', change.petname || '']];
  }
  return {
    kind: 3,
    created_at: Math.max(nowSec, base.createdAt + 1),
    tags: [[...LP_CLIENT_TAG], ...tags],
    content: base.content,
  };
}

/**
 * The app-side contact list for a freshly built kind-3, carrying over any
 * already-loaded profiles so names and avatars don't blank out.
 */
export function contactsFromEvent(
  tags: string[][],
  localContacts: readonly NostrContact[],
): NostrContact[] {
  const known = new Map(localContacts.map((c) => [c.pubkey.toLowerCase(), c]));
  return tagsToContacts(tags).map((c) => ({ ...c, profile: known.get(c.pubkey)?.profile ?? null }));
}

const followSet = (tags: string[][]) =>
  new Set(
    tags.filter((t) => t[0] === 'p' && typeof t[1] === 'string').map((t) => t[1].toLowerCase()),
  );

/**
 * Fetch → resolve → apply. Returns the unsigned kind-3 to publish, the
 * matching local list, and whether the follow set actually changed (a follow
 * of someone the relay list already has needs no new event, so no signer
 * prompt). `null` when publishing would risk wiping the user's real list.
 */
export async function prepareContactListUpdate({
  pubkey,
  relays,
  localContacts,
  change,
  fetchLatest = fetchLatestContactList,
}: {
  pubkey: string;
  relays: string[];
  localContacts: readonly NostrContact[];
  change: ContactChange;
  fetchLatest?: typeof fetchLatestContactList;
}): Promise<{
  event: { kind: 3; created_at: number; tags: string[][]; content: string };
  contacts: NostrContact[];
  changed: boolean;
} | null> {
  const fetched = await fetchLatest(pubkey, relays);
  const base = resolveContactListBase(fetched, localContacts);
  if (!base) return null;
  const event = applyContactChange(base, change);
  const before = followSet(base.tags);
  const after = followSet(event.tags);
  const changed = before.size !== after.size || [...after].some((pk) => !before.has(pk));
  return { event, contacts: contactsFromEvent(event.tags, localContacts), changed };
}
