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
