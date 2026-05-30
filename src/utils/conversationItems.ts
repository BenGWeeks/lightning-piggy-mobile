import type { SharedLocation } from '../services/locationService';
import type { LiveLocationMarker } from '../services/liveLocationService';
import type { TransactionDetailData } from '../components/TransactionDetailSheet';
import type { WalletState } from '../types/wallet';
import { classifyMessageContent } from './messageContent';
import { sanitizeDisplayText } from './sanitizeDisplayText';

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

// Merge classified DM messages with wallet zap rows, sort newest-first, and
// interleave "Today / Yesterday / <date>" dividers between day groups.
export function buildConversationItems(
  messages: ConversationMessageInput[],
  zapItems: TimedItem[],
): Item[] {
  const msgItems: TimedItem[] = messages.map((m) => {
    // Classify each raw DM into the variant the renderer expects. Same
    // shape used by the group screen (via `classifyMessageContent`)
    // — keeps gif / geo detection in one place.
    const classified = classifyMessageContent(m.text);
    if (classified.kind === 'gif') {
      return {
        kind: 'gif',
        id: `dm-${m.id}`,
        fromMe: m.fromMe,
        url: classified.url,
        createdAt: m.createdAt,
      };
    }
    if (classified.kind === 'location') {
      return {
        kind: 'location',
        id: `dm-${m.id}`,
        fromMe: m.fromMe,
        location: classified.location,
        createdAt: m.createdAt,
      };
    }
    if (classified.kind === 'liveLocationMarker') {
      return {
        kind: 'liveLocationMarker',
        id: `dm-${m.id}`,
        fromMe: m.fromMe,
        marker: classified.marker,
        createdAt: m.createdAt,
      };
    }
    return {
      kind: 'message',
      id: `dm-${m.id}`,
      fromMe: m.fromMe,
      // Drop orphaned object-replacement / zero-width placeholders so an
      // inline-attachment artifact doesn't render as a tofu box (#764).
      text: sanitizeDisplayText(m.text),
      createdAt: m.createdAt,
    };
  });
  // Descending order — index 0 is newest. The FlatList is `inverted`, so
  // index 0 renders at the visual bottom (chat default) and the
  // RefreshControl attaches to the visual bottom too, which is what
  // drives the pull-up-to-refresh gesture.
  const sorted = [...msgItems, ...zapItems].sort((a, b) => b.createdAt - a.createdAt);

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
