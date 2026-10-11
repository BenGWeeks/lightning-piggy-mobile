import type { Filter } from 'nostr-tools/filter';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { pool } from './nostrPool';
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
  /** `created_at` of the event this came from. */
  createdAt: number;
}

export type ContactListFetchResult =
  /** Newest signature-verified kind-3 from the relays. */
  | { status: 'found'; base: ContactListBase }
  /**
   * At least `MIN_EMPTY_CONFIRMATIONS` relays CONNECTED and sent a real EOSE,
   * and no relay delivered any kind-3 from the author (valid or not): the
   * user genuinely has no list yet, e.g. a brand-new account.
   */
  | { status: 'empty'; confirmedBy: number }
  /** Anything less certain: too few answers, timeouts, or an unverifiable list. */
  | { status: 'failed' };

export type ContactChange =
  | { type: 'follow'; pubkey: string; relay?: string | null; petname?: string | null }
  | { type: 'unfollow'; pubkey: string };

// Hard cap on the whole fetch. Generous: on a busy device the JS thread can
// sit on relay replies for seconds (measured: nothing processed within 5 s on
// a loaded emulator), and a fetch that can't decide refuses the write.
export const CONTACT_LIST_FETCH_TIMEOUT_MS = 10000;
// Per-relay connection timeout, so a dead relay is written off quickly.
export const CONTACT_LIST_CONNECT_TIMEOUT_MS = 5000;
// Relays that must positively confirm "no kind-3" before we treat the list as
// empty and publish a fresh one.
export const MIN_EMPTY_CONFIRMATIONS = 2;

/** The slice of a nostr-tools relay this module needs (injectable for tests). */
export interface ContactListRelay {
  subscribe(
    filters: Filter[],
    params: {
      onevent: (event: NostrEvent) => void;
      oninvalidevent: (event: unknown) => void;
      oneose: () => void;
      onclose: (reason: string) => void;
      eoseTimeout: number;
    },
  ): { close: () => void };
}
export type ConnectContactListRelay = (url: string, timeoutMs: number) => Promise<ContactListRelay>;

// The pool's shared socket per relay (no extra connections).
const connectViaPool: ConnectContactListRelay = (url, timeoutMs) =>
  pool.ensureRelay(url, { connectionTimeout: timeoutMs }) as unknown as Promise<ContactListRelay>;

/** Replaceable-event order: newer `created_at` wins; on a tie, the lowest id. */
function isNewerKind3(candidate: NostrEvent, current: NostrEvent | null): boolean {
  if (!current) return true;
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at;
  return candidate.id < current.id;
}

type RelayState = 'pending' | 'eose' | 'failed';

/**
 * Fetch the user's newest kind-3 with one `limit: 1` subscription per relay,
 * tracking each relay's connection and EOSE ourselves. The pool's aggregate
 * "done" can't be trusted here (#1271): nostr-tools counts a relay that failed
 * to connect, or that hit its eoseTimeout, as EOSE. So:
 * - our eoseTimeout is far past the overall cap, so every EOSE seen is real;
 * - only relays that connected AND sent EOSE count towards `empty`;
 * - every kind-3 from the author counts, including ones that fail signature
 *   checks (`oninvalidevent`). A list we can't verify means `failed`, never
 *   `empty`, because a dropped event followed by EOSE is exactly how an
 *   existing list once got overwritten.
 * Only events authored by `pubkey` that pass a full schnorr check can be a
 * base. A forged list must never be signed and republished as the user's.
 */
export function fetchLatestContactList(
  pubkey: string,
  relays: string[],
  {
    timeoutMs = CONTACT_LIST_FETCH_TIMEOUT_MS,
    connectTimeoutMs = CONTACT_LIST_CONNECT_TIMEOUT_MS,
    connect = connectViaPool,
  }: {
    timeoutMs?: number;
    connectTimeoutMs?: number;
    connect?: ConnectContactListRelay;
  } = {},
): Promise<ContactListFetchResult> {
  const author = pubkey.toLowerCase();
  const urls = [...new Set(relays)];
  if (urls.length === 0) return Promise.resolve({ status: 'failed' });
  const isAuthorKind3 = (e: unknown): boolean => {
    const ev = e as Partial<NostrEvent> | null;
    return ev?.kind === 3 && typeof ev.pubkey === 'string' && ev.pubkey.toLowerCase() === author;
  };
  return new Promise((resolve) => {
    const states = new Map<string, RelayState>(urls.map((u) => [u, 'pending']));
    const subs: { close: () => void }[] = [];
    let best: NostrEvent | null = null;
    let unverifiable = 0;
    let settled = false;
    const startedAt = Date.now();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const sub of subs) {
        try {
          sub.close();
        } catch {
          // already closed
        }
      }
      const confirmedBy = [...states.values()].filter((st) => st === 'eose').length;
      let result: ContactListFetchResult;
      if (best) {
        result = {
          status: 'found',
          base: { tags: best.tags, content: best.content, createdAt: best.created_at },
        };
      } else if (unverifiable === 0 && confirmedBy >= MIN_EMPTY_CONFIRMATIONS) {
        result = { status: 'empty', confirmedBy };
      } else {
        result = { status: 'failed' };
      }
      if (__DEV__) {
        console.log(
          `[ContactList] kind-3 fetch ${result.status} after ${Date.now() - startedAt}ms ` +
            `(EOSE from ${confirmedBy}/${urls.length} relay(s), ${unverifiable} unverifiable)`,
        );
      }
      resolve(result);
    };
    const settle = (url: string, state: Exclude<RelayState, 'pending'>) => {
      if (settled || states.get(url) !== 'pending') return;
      states.set(url, state);
      if ([...states.values()].every((st) => st !== 'pending')) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    for (const url of urls) {
      connect(url, Math.min(connectTimeoutMs, timeoutMs))
        .then((relay) => {
          if (settled) return;
          const sub = relay.subscribe([{ kinds: [3], authors: [author], limit: 1 } as Filter], {
            // Far past our cap: nostr-tools' synthetic EOSE must never fire first.
            eoseTimeout: timeoutMs * 3,
            onevent(event) {
              if (!isAuthorKind3(event)) return;
              if (!verifyEvent(event)) {
                unverifiable++;
                return;
              }
              if (isNewerKind3(event, best)) best = event;
            },
            oninvalidevent(event) {
              if (isAuthorKind3(event)) unverifiable++;
            },
            oneose: () => settle(url, 'eose'),
            onclose: () => settle(url, 'failed'),
          });
          subs.push(sub);
          if (settled) sub.close();
        })
        .catch(() => settle(url, 'failed'));
    }
  });
}

/**
 * Pick what a follow/unfollow is applied to, or `null` to refuse publishing.
 * The base must be a complete list we can vouch for:
 * - `found`: the relays' newest verified kind-3, or the one this session last
 *   published if that's newer (relays can lag right after a write);
 * - `empty`: relays positively confirmed there's no list. Trusted ONLY for an
 *   account created in Lightning Piggy on this device (`allowEmpty`, see
 *   `newAccountContactList`): start from this session's own list or an empty
 *   one. An imported / signed-in key's real list may live on relays we don't
 *   query, so for it `empty` refuses like `failed`;
 * - `failed`: refuse. The app's local `contacts` is never a base (#1271): it
 *   may never have loaded, and even a non-empty copy can be up to a day stale
 *   (a follow made in another client would be deleted).
 */
export function resolveContactListBase(
  fetched: ContactListFetchResult,
  lastPublished?: ContactListBase | null,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): ContactListBase | null {
  if (fetched.status === 'failed') return null;
  if (fetched.status === 'empty') {
    if (!allowEmpty) return null;
    return lastPublished ?? { tags: [], content: '', createdAt: 0 };
  }
  if (lastPublished && lastPublished.createdAt > fetched.base.createdAt) return lastPublished;
  return fetched.base;
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
  lastPublished,
  allowEmptyList = false,
  fetchLatest = fetchLatestContactList,
}: {
  pubkey: string;
  relays: string[];
  /** Only used to carry already-loaded profiles onto the rebuilt list. */
  localContacts: readonly NostrContact[];
  change: ContactChange;
  /** The kind-3 this session last published for `pubkey`, if any. */
  lastPublished?: ContactListBase | null;
  /** The account was created in Lightning Piggy on this device (may start a fresh list). */
  allowEmptyList?: boolean;
  fetchLatest?: typeof fetchLatestContactList;
}): Promise<{
  event: { kind: 3; created_at: number; tags: string[][]; content: string };
  contacts: NostrContact[];
  changed: boolean;
  /** A kind-3 for the account exists on the relays (so it's no longer "new"). */
  listSeen: boolean;
} | null> {
  const fetched = await fetchLatest(pubkey, relays);
  const base = resolveContactListBase(fetched, lastPublished, { allowEmpty: allowEmptyList });
  if (!base) return null;
  const event = applyContactChange(base, change);
  const before = followSet(base.tags);
  const after = followSet(event.tags);
  const changed = before.size !== after.size || [...after].some((pk) => !before.has(pk));
  return {
    event,
    contacts: contactsFromEvent(event.tags, localContacts),
    changed,
    listSeen: fetched.status === 'found',
  };
}
