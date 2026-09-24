import type { WalletState, WalletTransaction } from '../types/wallet';
import type { NostrContact, NostrProfile } from '../types/nostr';
import { parsePoll, isPollVoteMessage } from './pollMessage';

// A valid Nostr pubkey is 64 lowercase hex chars. Used to drop inbox entries
// keyed on a malformed partner pubkey — rows that predate the partnerFromRumor
// validation fix (#849) and would otherwise render as un-nameable raw-hex
// `dcc…` conversations the user can't open or identify.
const PUBKEY_HEX64 = /^[0-9a-f]{64}$/;

export interface ConversationSummary {
  /**
   * Stable id — `pubkey` (hex) for identified counterparties; otherwise
   * `anon:<walletId>:<paymentHash|txid|bolt11>` so the id doesn't shift
   * when new zaps are prepended to the transaction list (keeps FlashList
   * row identity stable across renders).
   */
  id: string;
  pubkey: string | null;
  name: string;
  picture: string | null;
  nip05: string | null;
  lightningAddress: string | null;
  /** Last activity unix seconds. */
  lastActivityAt: number;
  lastAmountSats: number;
  /** `incoming` = they zapped us, `outgoing` = we zapped them. */
  lastDirection: 'incoming' | 'outgoing';
  /** Zap comment on the last interaction, if any. */
  lastComment: string;
  anonymous: boolean;
}

function displayNameFor(
  info: NonNullable<WalletTransaction['zapCounterparty']>,
  contact: NostrContact | undefined,
): string {
  const p = info.profile;
  const fromProfile = p?.displayName || p?.name;
  if (fromProfile?.trim()) return fromProfile.trim();
  const fromContact = contact?.profile?.displayName || contact?.profile?.name || contact?.petname;
  if (fromContact?.trim()) return fromContact.trim();
  if (info.anonymous) return 'Anonymous';
  if (info.pubkey) return info.pubkey.slice(0, 12);
  return 'Unknown';
}

/**
 * Derive a WhatsApp-style conversation list from zap history across all
 * wallets, sorted newest-first. One row per counterparty pubkey (anonymous
 * zaps are each their own row, since we can't merge them).
 */
export function buildConversationSummaries(
  wallets: WalletState[],
  contacts: NostrContact[],
): ConversationSummary[] {
  const contactByPubkey = new Map<string, NostrContact>();
  for (const c of contacts) contactByPubkey.set(c.pubkey, c);

  const byPubkey = new Map<string, ConversationSummary>();
  const anonymous: ConversationSummary[] = [];

  for (const wallet of wallets) {
    for (const tx of wallet.transactions) {
      const info = tx.zapCounterparty;
      if (!info || typeof info !== 'object') continue;
      const ts = tx.settled_at ?? tx.created_at ?? null;
      if (ts == null) continue;

      const contact = info.pubkey ? contactByPubkey.get(info.pubkey) : undefined;
      const name = displayNameFor(info, contact);
      // Anonymous rows need an id that survives list churn (new zaps prepended,
      // resolver re-runs). Prefer paymentHash → txid → bolt11; fall back to
      // the event timestamp so we never collide with an earlier-indexed anon.
      const anonKey = tx.paymentHash ?? tx.txid ?? tx.bolt11 ?? `ts-${ts}`;
      const summary: ConversationSummary = {
        id: info.pubkey ?? `anon:${wallet.id}:${anonKey}`,
        pubkey: info.pubkey,
        name,
        picture: info.profile?.picture ?? contact?.profile?.picture ?? null,
        nip05: info.profile?.nip05 ?? contact?.profile?.nip05 ?? null,
        lightningAddress: contact?.profile?.lud16 ?? null,
        lastActivityAt: ts,
        lastAmountSats: Math.abs(tx.amount),
        lastDirection: tx.type,
        lastComment: info.comment ?? '',
        anonymous: info.anonymous,
      };

      if (!info.pubkey) {
        anonymous.push(summary);
        continue;
      }
      const existing = byPubkey.get(info.pubkey);
      if (!existing || summary.lastActivityAt > existing.lastActivityAt) {
        byPubkey.set(info.pubkey, summary);
      }
    }
  }

  return [...byPubkey.values(), ...anonymous].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Relative timestamp suited to a chat row ("2m", "1h", "Yesterday", "3 Apr").
 * `now` is injected for deterministic tests.
 */
export function formatConversationTimestamp(tsSeconds: number, now: Date = new Date()): string {
  const ts = new Date(tsSeconds * 1000);
  const diffMs = now.getTime() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  // Same calendar day → show hours.
  const sameDay =
    ts.getFullYear() === now.getFullYear() &&
    ts.getMonth() === now.getMonth() &&
    ts.getDate() === now.getDate();
  if (sameDay) return `${diffHr}h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    ts.getFullYear() === yesterday.getFullYear() &&
    ts.getMonth() === yesterday.getMonth() &&
    ts.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';
  const sameYear = ts.getFullYear() === now.getFullYear();
  return ts.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Short preview line (last-message column). */
export function conversationPreview(s: ConversationSummary): string {
  const amount = s.lastAmountSats.toLocaleString();
  const prefix = s.lastDirection === 'outgoing' ? 'You: ' : '';
  const comment = s.lastComment.trim();
  if (comment) {
    // Don't leak the poll wire-format into the inbox row — show a friendly label.
    const poll = parsePoll(comment);
    if (poll) return `${prefix}📊 Poll: ${poll.question}`;
    if (isPollVoteMessage(comment)) return `${prefix}📊 Voted on a poll`;
    return `${prefix}${comment}`;
  }
  return `${prefix}⚡ ${amount} sats`;
}

/**
 * A decrypted DM drawn from the inbox fetch — kind 4 (NIP-04) or kind 14
 * (NIP-17 rumor unwrapped from a kind-1059 gift wrap). `wireKind` is 4
 * for legacy, 14 for NIP-17 chat, 15 for NIP-17 file.
 */
export interface DmInboxEntry {
  /** Event id (kind-4 event id, or kind-1059 wrap id for NIP-17). Load-
   * bearing for inbox merge dedup — created_at is only second-resolution
   * so two events from the same peer in the same second would collide
   * on a (partnerPubkey, createdAt, wireKind) key. */
  id: string;
  partnerPubkey: string;
  fromMe: boolean;
  createdAt: number;
  /** Inbox-LIST preview text — for a kind-16/17 order/receipt this is a readable
   * summary ("🛒 Order Placed · 21 sats"), NOT the raw order JSON. */
  text: string;
  wireKind: number;
  /** Conversation-THREAD render content — the raw `textForRumor` output kept
   * alongside the preview so a freshly-decrypted row renders correctly on the
   * first open. For a kind-16/17 order this is the serialized order JSON the
   * card renderer (`parseStoredOrder`) needs; for a plain DM it equals `text`.
   * Absent on legacy entries — consumers fall back to `text`. (#market) */
  renderText?: string;
  /** NIP-17 rumor (inner kind-14/15) event id — stable across the recipient +
   * self wraps and identical to what the sender computed at send time. Keys the
   * delivery-status store so a sent bubble's tick survives the local- → echo id
   * swap (#857). `id` above is the OUTER wrap id (random per ephemeral key), so
   * it can't serve as that key. Absent for legacy / received rows. */
  rumorId?: string;
}

import * as nip19 from 'nostr-tools/nip19';

/** Generates the display name shown when we have no kind-0 profile yet.
 * Prefers an npub prefix (what the rest of the app uses when copying a
 * pubkey for users) over raw hex. Returns the pubkey lowercased. */
function fallbackName(partnerPubkey: string): string {
  try {
    return nip19.npubEncode(partnerPubkey).slice(0, 12) + '…';
  } catch {
    return partnerPubkey.slice(0, 12);
  }
}

/** Dual-publish window — if the same partner sends a NIP-04 and a NIP-17
 * copy of the same message within this many seconds, treat them as one
 * and prefer the NIP-17 row. 5 minutes is generous enough to absorb relay
 * propagation jitter (NIP-17 wraps use a randomised created_at up to 2
 * days in the past, but we deduplicate on rumor.created_at which is the
 * real send time, so 5 min of headroom is sufficient). */
const DUAL_PUBLISH_WINDOW_SEC = 5 * 60;

/** Similarly, when merging a zap row and a DM row for the same partner,
 * if the two events are within this window pick the DM's preview text.
 * Sorting timestamp still uses whichever is newer so the inbox order is
 * correct — we only override the preview.  */
const DM_PREVIEW_PREFERENCE_WINDOW_SEC = 5 * 60;

/**
 * Bucket DM entries by partner pubkey and reduce to one ConversationSummary
 * per partner. `trustedPubkeys` (formerly `followPubkeys`, kept on the
 * parameter name for diff churn but the semantics have widened) is the
 * lowercase-hex trust set the caller wants to enforce here as a render-
 * time safety net: even though `refreshDmInbox` already filters at the
 * data layer, rebuilding the list after a contact leaves the tier should
 * also drop them here.
 *
 * Since #547 callers pass a **tier-aware trust set** (friends / fof /
 * all), not just the L1 follow list it used to be. So `trustedPubkeys`
 * may legitimately include friends-of-follows / seeds / the viewer
 * themself depending on the current `wotTier`. The contract is the
 * same — pubkeys present in the set pass the filter — but don't
 * assume the contents are limited to direct follows.
 *
 * When a partner has both a NIP-04 and a NIP-17 message within
 * DUAL_PUBLISH_WINDOW_SEC we always pick the NIP-17 copy regardless of
 * which one has the newer timestamp. Clients in the wild deliver the
 * two copies in either order, and wraps are the preferred metadata-
 * minimising form — we never want a laggy kind-4 to displace its NIP-17
 * twin and "unhide" the sender identity in the preview.
 */
export function buildDmSummaries(
  entries: DmInboxEntry[],
  contacts: NostrContact[],
  followPubkeys?: ReadonlySet<string>,
  // Profiles for partners NOT in `contacts` (non-followed DM senders),
  // fetched separately so their name + avatar resolve instead of showing a
  // raw npub — keyed by lowercase pubkey (#664).
  extraProfiles?: ReadonlyMap<string, NostrProfile>,
): ConversationSummary[] {
  const contactByPubkey = new Map<string, NostrContact>();
  for (const c of contacts) contactByPubkey.set(c.pubkey.toLowerCase(), c);

  const winner = new Map<string, DmInboxEntry>();
  for (const entry of entries) {
    const key = entry.partnerPubkey.toLowerCase();
    // Drop entries with a malformed partner pubkey (#849): junk rows stored
    // before the partnerFromRumor fix would otherwise show as un-nameable
    // raw-hex `dcc…` conversations. The ingest fix stops new ones; this hides
    // any already in the store without a risky DB migration.
    if (!PUBKEY_HEX64.test(key)) continue;
    if (followPubkeys && !followPubkeys.has(key)) continue;
    const existing = winner.get(key);
    if (!existing) {
      winner.set(key, entry);
      continue;
    }

    const newIsNip17 = entry.wireKind !== 4;
    const existingIsNip17 = existing.wireKind !== 4;
    const diff = Math.abs(entry.createdAt - existing.createdAt);

    // Rule 1: NIP-17 always beats a NIP-04 twin inside the dual-publish
    // window, regardless of which arrived first. (The old `diff > 60`
    // path let a laggy kind-4 61 s newer than its wrap win the slot —
    // that was the bug called out in review.)
    if (diff <= DUAL_PUBLISH_WINDOW_SEC) {
      if (newIsNip17 && !existingIsNip17) {
        winner.set(key, entry);
        continue;
      }
      if (!newIsNip17 && existingIsNip17) {
        continue;
      }
      // Same wire kind within the window → newer wins.
      if (entry.createdAt > existing.createdAt) {
        winner.set(key, entry);
      }
      continue;
    }

    // Rule 2: outside the window, newer wins.
    if (entry.createdAt > existing.createdAt) {
      winner.set(key, entry);
    }
  }

  const summaries: ConversationSummary[] = [];
  for (const entry of winner.values()) {
    const key = entry.partnerPubkey.toLowerCase();
    const contact = contactByPubkey.get(key);
    // Prefer the contact's profile; for a non-followed sender fall back to the
    // separately-fetched profile so name + avatar still resolve (#664).
    const prof = contact?.profile ?? extraProfiles?.get(key) ?? null;
    const name =
      prof?.displayName?.trim() ||
      prof?.name?.trim() ||
      contact?.petname?.trim() ||
      fallbackName(entry.partnerPubkey);
    summaries.push({
      id: entry.partnerPubkey,
      pubkey: entry.partnerPubkey,
      name,
      picture: prof?.picture ?? null,
      nip05: prof?.nip05 ?? null,
      lightningAddress: prof?.lud16 ?? null,
      lastActivityAt: entry.createdAt,
      lastAmountSats: 0,
      lastDirection: entry.fromMe ? 'outgoing' : 'incoming',
      lastComment: entry.text,
      anonymous: false,
    });
  }

  return summaries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Merge zap-derived and DM-derived summaries into a single inbox list:
 * one row per identified partner, anonymous zap rows passed through
 * untouched (no pubkey → nothing to merge against).
 *
 * When a partner has both a zap row and a DM row, we use the newest
 * `lastActivityAt` as the sort key, but if the two events happened within
 * DM_PREVIEW_PREFERENCE_WINDOW_SEC of each other we prefer the DM's
 * `lastComment` for the preview text. Rationale: "You: Hello!" is a more
 * useful at-a-glance preview than "You: ⚡ 21 sats" when both happened in
 * the same conversational moment. Outside that window the newer event
 * wins outright, since an old zap followed by a long pause and then a
 * new DM should obviously show the DM.
 */
export function mergeSummaries(
  zap: ConversationSummary[],
  dm: ConversationSummary[],
): ConversationSummary[] {
  const zapByPubkey = new Map<string, ConversationSummary>();
  const dmByPubkey = new Map<string, ConversationSummary>();
  const anonymous: ConversationSummary[] = [];
  for (const s of zap) {
    if (!s.pubkey) {
      anonymous.push(s);
      continue;
    }
    zapByPubkey.set(s.pubkey.toLowerCase(), s);
  }
  for (const s of dm) {
    if (!s.pubkey) continue;
    dmByPubkey.set(s.pubkey.toLowerCase(), s);
  }

  const merged: ConversationSummary[] = [];
  const allKeys = new Set<string>([...zapByPubkey.keys(), ...dmByPubkey.keys()]);
  for (const key of allKeys) {
    const z = zapByPubkey.get(key);
    const d = dmByPubkey.get(key);
    if (z && d) {
      const newest = d.lastActivityAt >= z.lastActivityAt ? d : z;
      const diff = Math.abs(d.lastActivityAt - z.lastActivityAt);
      // Sort by whichever is newer; prefer DM preview text when close.
      const preferDmPreview = diff <= DM_PREVIEW_PREFERENCE_WINDOW_SEC;
      merged.push({
        ...newest,
        lastComment: preferDmPreview ? d.lastComment : newest.lastComment,
        lastAmountSats: preferDmPreview ? 0 : newest.lastAmountSats,
        lastDirection: newest.lastDirection,
      });
    } else if (d) {
      merged.push(d);
    } else if (z) {
      merged.push(z);
    }
  }

  return [...merged, ...anonymous].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
