import type { SharedLocation } from '../services/locationService';
import type { LiveLocationMarker } from '../services/liveLocationService';
import type { TransactionDetailData } from '../components/TransactionDetailSheet';
import type { WalletState } from '../types/wallet';
import { classifyMessageContent } from './messageContent';
import type { ParsedPoll } from './pollMessage';
import { sanitizeDisplayText } from './sanitizeDisplayText';
import type { DeliveryStatus } from './dmDeliveryStatus';
import {
  bolt11FromText,
  parseStoredOrder,
  payableBolt11,
  type ParsedOrderEvent,
} from './orderEvents';

// The row variants ConversationScreen's FlatList renders. Extracted from the
// screen (with the pure build logic below) to keep the screen file under the
// #703 size cap. Kept dependency-light so it stays unit-testable.
export type Item =
  | {
      kind: 'message';
      id: string;
      fromMe: boolean;
      text: string;
      createdAt: number;
      // Per-relay delivery breakdown for a sent (fromMe) message (#856).
      deliveryStatus?: DeliveryStatus;
      // Wire protocol (4 = NIP-04, 14/15 = NIP-17) for the message-info sheet.
      wireKind?: number;
      // Cross-peer-stable id (NIP-17 inner rumor id / NIP-04 wire id) used as
      // the target for per-message NIP-25 reactions + zaps (#205). Undefined
      // for optimistic-local sends and warm-cache rows without a rumor id.
      rumorId?: string;
    }
  | {
      kind: 'zap';
      id: string;
      fromMe: boolean;
      amountSats: number;
      comment: string;
      createdAt: number;
      tx: TransactionDetailData;
    }
  | {
      kind: 'location';
      id: string;
      fromMe: boolean;
      location: SharedLocation;
      createdAt: number;
      // Reaction/zap target (#205) — see the `message` variant.
      rumorId?: string;
    }
  | {
      kind: 'liveLocationMarker';
      id: string;
      fromMe: boolean;
      marker: LiveLocationMarker;
      createdAt: number;
    }
  | {
      kind: 'gif';
      id: string;
      fromMe: boolean;
      url: string;
      createdAt: number;
      // Reaction/zap target (#205) — see the `message` variant.
      rumorId?: string;
    }
  | {
      // Marketplace order / receipt card (#market) — a kind-16/17 event a
      // Nostr market addressed to the buyer, rendered as a distinct card.
      kind: 'order';
      id: string;
      fromMe: boolean;
      order: ParsedOrderEvent;
      createdAt: number;
    }
  | {
      // Generic fallback for a stored message whose wireKind the app doesn't
      // render (an inner Nostr event of an unhandled kind — now or in future).
      // Rendered as a muted placeholder bubble instead of a blank one (#market
      // follow-up). `rawKind` is the numeric Nostr kind.
      kind: 'unsupported';
      id: string;
      fromMe: boolean;
      rawKind: number;
      createdAt: number;
    }
  | {
      kind: 'poll';
      id: string;
      fromMe: boolean;
      poll: ParsedPoll;
      createdAt: number;
    }
  | {
      kind: 'dayHeader';
      id: string;
      label: string;
    };

// Every Item variant except the dayHeader synthetic row — these are the
// ones that have a real `createdAt` and participate in chronological sort.
export type TimedItem = Exclude<Item, { kind: 'dayHeader' }>;

// The raw 1:1 DM shape ConversationScreen holds in state.
export interface ConversationMessageInput {
  id: string;
  fromMe: boolean;
  text: string;
  createdAt: number;
  // Per-relay delivery breakdown for a sent message (#856), attached by the
  // composer's optimistic append. Carried through to the message Item.
  deliveryStatus?: DeliveryStatus;
  // Wire protocol (4 = NIP-04, 14/15 = NIP-17) for the message-info sheet.
  wireKind?: number;
  // NIP-17 inner-rumor id (#857) — the delivery-store key; stable across the
  // optimistic row and its relay echo. Set on sent rows only.
  rumorId?: string;
}

// Local-only formatter — only used for the dayHeader rule between
// chronological message groups, so it stays here rather than in the
// shared `messageContent` util (which sticks to bubble-level concerns).
export function formatDayHeader(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Wallet-derived zap rows for a 1:1 thread: Lightning txs whose zap
// counterparty is this conversation's peer. Pulled from the wallet ledger,
// not from Nostr messages.
export function buildZapItems(wallets: WalletState[], pubkey: string): TimedItem[] {
  const out: TimedItem[] = [];
  for (const w of wallets) {
    for (const tx of w.transactions) {
      const cp = tx.zapCounterparty;
      if (!cp || !cp.pubkey || cp.pubkey !== pubkey) continue;
      const when = tx.settled_at ?? tx.created_at;
      if (!when) continue;
      out.push({
        kind: 'zap',
        id: `zap-${tx.paymentHash ?? tx.bolt11 ?? when}-${tx.type}`,
        fromMe: tx.type === 'outgoing',
        amountSats: Math.abs(tx.amount),
        comment: cp.comment ?? '',
        createdAt: when,
        tx,
      });
    }
  }
  return out;
}

// Wire kinds the conversation can actually render: 4 (NIP-04 DM), 14 (NIP-17
// DM text), 15 (NIP-17 file → image/voice/link), 16/17 (marketplace order /
// receipt cards). A stored message whose wireKind isn't one of these is an
// inner event of a kind we don't display — surfaced as the `unsupported`
// placeholder rather than a blank bubble. Plain text rows carry no wireKind
// (`undefined`), so they never hit the fallback.
const RENDERABLE_WIRE_KINDS = new Set<number>([4, 14, 15, 16, 17]);

/**
 * Suppress a kind-14 chat-note that merely re-delivers an order's Lightning
 * invoice when the SAME conversation already renders the kind-16 order card for
 * that invoice (#market dedup).
 *
 * The order-service delivers an order's invoice two ways for client
 * compatibility: a kind-16 type-2 payment request (LP's rich "order card") and
 * a kind-14 NIP-17 chat note carrying the same human-readable line + the SAME
 * raw bolt11, so generic DM clients that can't render kind-16 still get a
 * payable invoice. A Gamma-aware client like LP would otherwise show BOTH — the
 * card and a duplicate invoice bubble — so we drop the note.
 *
 * Correlation is by the shared bolt11, not the `["order", …]` tag: LP's
 * dm_messages store retains only a row's content + wireKind, never the kind-14
 * rumor's tags, so the order tag isn't available at render time — but the
 * invoice string IS retained on both sides (the card's `payment.value` and the
 * note's content) and is an exact, hard key. A note is dropped ONLY when its
 * bolt11 equals a payable order card's invoice, so a regular chat message —
 * even one that happens to quote an unrelated invoice — is never suppressed,
 * and a note with no matching card still shows (it may be the only invoice the
 * buyer has — the whole point of the fallback). Operating on the assembled item
 * set means the kind-14 and kind-16 can arrive in either order.
 */
export function suppressDuplicateOrderInvoiceNotes(items: TimedItem[]): TimedItem[] {
  // Every payable bolt11 shown as an order card in this conversation. Only a
  // kind-16 type-2 payment request yields one (`payableBolt11`), so a receipt
  // or order-placed card never suppresses anything.
  const orderInvoices = new Set<string>();
  for (const it of items) {
    if (it.kind !== 'order') continue;
    const invoice = payableBolt11(it.order);
    if (invoice) orderInvoices.add(invoice);
  }
  if (orderInvoices.size === 0) return items;
  return items.filter((it) => {
    // Only a kind-14 chat bubble can be an order-invoice fallback note; leave
    // order cards, zaps, files, NIP-04 (kind-4) rows, etc. untouched.
    if (it.kind !== 'message' || it.wireKind !== 14) return true;
    const invoice = bolt11FromText(it.text);
    return !(invoice && orderInvoices.has(invoice));
  });
}

// Merge classified DM messages with wallet zap rows, sort newest-first, and
// interleave "Today / Yesterday / <date>" dividers between day groups.
export function buildConversationItems(
  messages: ConversationMessageInput[],
  zapItems: TimedItem[],
): Item[] {
  const msgItems: TimedItem[] = messages.flatMap((m): TimedItem[] => {
    // Marketplace order / receipt rows (kind 16/17) store order JSON in `text`;
    // render them as an order card rather than a chat bubble (#market).
    if (m.wireKind === 16 || m.wireKind === 17) {
      const order = parseStoredOrder(m.text);
      if (order) {
        return [
          {
            kind: 'order',
            id: `dm-${m.id}`,
            fromMe: m.fromMe,
            order,
            createdAt: m.createdAt,
          },
        ];
      }
      // Unparseable order/receipt row (corrupt, or a non-order payload sharing
      // the kind, e.g. a gift-wrapped NIP-18 repost) — render the muted
      // placeholder rather than leaking the raw JSON blob into the thread
      // (mirrors `orderPreviewFromContent` in the inbox preview).
      return [
        {
          kind: 'unsupported',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          rawKind: m.wireKind,
          createdAt: m.createdAt,
        },
      ];
    }
    // Generic, future-proof fallback: a stored message whose wireKind we don't
    // render (an inner Nostr event of an unhandled kind) becomes a muted
    // placeholder rather than a blank text bubble. Only fires for a defined
    // wireKind outside the renderable set — plain rows (no wireKind) and the
    // 4/14/15/16/17 kinds handled above/below are unaffected.
    if (m.wireKind !== undefined && !RENDERABLE_WIRE_KINDS.has(m.wireKind)) {
      return [
        {
          kind: 'unsupported',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          rawKind: m.wireKind,
          createdAt: m.createdAt,
        },
      ];
    }
    // Classify each raw DM into the variant the renderer expects. Same
    // shape used by the group screen (via `classifyMessageContent`)
    // — keeps gif / geo / poll detection in one place.
    const classified = classifyMessageContent(m.text);
    // Vote messages aren't shown as bubbles — they're aggregated into the
    // referenced poll's tally by the screen, so drop them from the row list.
    if (classified.kind === 'pollVote') return [];
    if (classified.kind === 'gif') {
      return [
        {
          kind: 'gif',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          url: classified.url,
          createdAt: m.createdAt,
          rumorId: m.rumorId,
        },
      ];
    }
    if (classified.kind === 'location') {
      return [
        {
          kind: 'location',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          location: classified.location,
          createdAt: m.createdAt,
          rumorId: m.rumorId,
        },
      ];
    }
    if (classified.kind === 'poll') {
      return [
        {
          kind: 'poll',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          poll: classified.poll,
          createdAt: m.createdAt,
        },
      ];
    }
    if (classified.kind === 'liveLocationMarker') {
      return [
        {
          kind: 'liveLocationMarker',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          marker: classified.marker,
          createdAt: m.createdAt,
        },
      ];
    }
    return [
      {
        kind: 'message',
        id: `dm-${m.id}`,
        fromMe: m.fromMe,
        // Drop orphaned object-replacement / zero-width placeholders so an
        // inline-attachment artifact doesn't render as a tofu box (#764).
        text: sanitizeDisplayText(m.text),
        createdAt: m.createdAt,
        deliveryStatus: m.deliveryStatus,
        wireKind: m.wireKind,
        rumorId: m.rumorId,
      },
    ];
  });
  // Drop any kind-14 chat-note that just re-delivers an order's invoice when
  // its kind-16 order card is also present (#market dedup) — a selector over the
  // assembled set, so the two events can arrive in either order.
  const deduped = suppressDuplicateOrderInvoiceNotes(msgItems);

  // Descending order — index 0 is newest. The FlatList is `inverted`, so
  // index 0 renders at the visual bottom (chat default) and the
  // RefreshControl attaches to the visual bottom too, which is what
  // drives the pull-up-to-refresh gesture.
  const sorted = [...deduped, ...zapItems].sort((a, b) => b.createdAt - a.createdAt);

  // Interleave "Today / Yesterday / <date>" dividers between day groups.
  // With an inverted FlatList the array runs newest → oldest, so each
  // divider must sit AFTER its group's oldest entry in array order
  // (= visually above the group's newest entry). This gives the same
  // chat-standard look as Transactions' date headers.
  if (sorted.length === 0) return sorted;
  const withHeaders: Item[] = [];
  const dayKey = (ts: number) => new Date(ts * 1000).toDateString();
  let prevKey: string | null = null;
  let prevTs: number | null = null;
  for (const it of sorted) {
    const key = dayKey(it.createdAt);
    if (prevKey !== null && prevKey !== key && prevTs !== null) {
      withHeaders.push({
        kind: 'dayHeader',
        id: `day-${prevKey}`,
        label: formatDayHeader(prevTs),
      });
    }
    withHeaders.push(it);
    prevKey = key;
    prevTs = it.createdAt;
  }
  if (prevKey !== null && prevTs !== null) {
    withHeaders.push({
      kind: 'dayHeader',
      id: `day-${prevKey}`,
      label: formatDayHeader(prevTs),
    });
  }
  return withHeaders;
}
