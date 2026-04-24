import type { WalletState, WalletTransaction } from '../types/wallet';
import type { NostrContact } from '../types/nostr';

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
  if (s.lastComment.trim()) {
    return `${prefix}${s.lastComment.trim()}`;
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
  text: string;
  wireKind: number;
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
 * per partner. The caller passes the viewer's followed pubkeys (lowercase)
 * as a safety net: even though refreshDmInbox already filters at the data
 * layer, rebuilding the list after a contact is un-followed should also
 * drop them here — the "Following only" rule is a render-time invariant,
 * not just a fetch-time one.
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
  followPubkeys?: Set<string>,
): ConversationSummary[] {
  const contactByPubkey = new Map<string, NostrContact>();
  for (const c of contacts) contactByPubkey.set(c.pubkey.toLowerCase(), c);

  const winner = new Map<string, DmInboxEntry>();
  for (const entry of entries) {
    const key = entry.partnerPubkey.toLowerCase();
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
    const contact = contactByPubkey.get(entry.partnerPubkey.toLowerCase());
    const name =
      contact?.profile?.displayName?.trim() ||
      contact?.profile?.name?.trim() ||
      contact?.petname?.trim() ||
      fallbackName(entry.partnerPubkey);
    summaries.push({
      id: entry.partnerPubkey,
      pubkey: entry.partnerPubkey,
      name,
      picture: contact?.profile?.picture ?? null,
      nip05: contact?.profile?.nip05 ?? null,
      lightningAddress: contact?.profile?.lud16 ?? null,
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
