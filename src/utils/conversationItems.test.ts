// Tests for the pure 1:1-conversation item-building extracted from
// ConversationScreen. classifyMessageContent is the only collaborator; we let
// the real one run (it's pure regex/parse) so gif/location detection is
// exercised end-to-end.
//
// classifyMessageContent → messageContent → boltzService pulls in
// bitcoinjs-lib's bip32 (ESM Jest can't resolve under jest-expo). Mock the one
// helper that drags it in; we don't exercise bitcoin-address detection here.
jest.mock('../services/boltzService', () => ({
  isBitcoinAddress: () => false,
}));

import {
  buildConversationItems,
  buildZapItems,
  formatDayHeader,
  type ConversationMessageInput,
} from './conversationItems';
import type { WalletState, ZapCounterpartyInfo } from '../types/wallet';

const PEER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

// Minimal zap-counterparty builder — only `pubkey` + `comment` matter to the
// builders under test; the rest of ZapCounterpartyInfo is filled with nulls.
function cp(pubkey: string, comment = ''): ZapCounterpartyInfo {
  return { pubkey, comment, profile: null, anonymous: false };
}

// 2024-06-15 12:00:00 UTC and 2024-06-14 12:00:00 UTC — fixed so day-grouping
// is deterministic regardless of the runner's clock for the relative labels we
// don't assert on.
const DAY2 = Math.floor(Date.UTC(2024, 5, 15, 12) / 1000);
const DAY1 = Math.floor(Date.UTC(2024, 5, 14, 12) / 1000);

function walletWithTx(tx: Partial<WalletState['transactions'][number]>): WalletState {
  return {
    transactions: [
      {
        type: 'incoming',
        amount: 1000,
        created_at: DAY2,
        ...tx,
      } as WalletState['transactions'][number],
    ],
  } as WalletState;
}

describe('buildConversationItems', () => {
  it('returns an empty array for no messages and no zaps', () => {
    expect(buildConversationItems([], [])).toEqual([]);
  });

  it('classifies plain text as a message and sorts newest-first', () => {
    const messages: ConversationMessageInput[] = [
      { id: '1', fromMe: false, text: 'older', createdAt: DAY1 },
      { id: '2', fromMe: true, text: 'newer', createdAt: DAY2 },
    ];
    const items = buildConversationItems(messages, []);
    const nonHeaders = items.filter((i) => i.kind !== 'dayHeader');
    expect(nonHeaders[0]).toMatchObject({ kind: 'message', id: 'dm-2', text: 'newer' });
    expect(nonHeaders[1]).toMatchObject({ kind: 'message', id: 'dm-1', text: 'older' });
  });

  it('inserts a day-header divider between messages from different days', () => {
    const messages: ConversationMessageInput[] = [
      { id: '1', fromMe: false, text: 'day one', createdAt: DAY1 },
      { id: '2', fromMe: true, text: 'day two', createdAt: DAY2 },
    ];
    const headers = buildConversationItems(messages, []).filter((i) => i.kind === 'dayHeader');
    // Two distinct days → a divider after each day's group (inverted list).
    expect(headers.length).toBe(2);
  });

  it('detects a gif URL and tags it as a gif item', () => {
    const items = buildConversationItems(
      [
        {
          id: 'g',
          fromMe: true,
          text: 'https://media.giphy.com/media/abc/giphy.gif',
          createdAt: DAY2,
        },
      ],
      [],
    );
    expect(items.find((i) => i.kind === 'gif')).toMatchObject({ kind: 'gif', id: 'dm-g' });
  });

  it('merges zap items in with messages by timestamp', () => {
    const zaps = buildZapItems(
      [
        walletWithTx({
          type: 'incoming',
          amount: 500,
          settled_at: DAY2 + 10,
          paymentHash: 'hash1',
          zapCounterparty: cp(PEER, 'gm'),
        }),
      ],
      PEER,
    );
    const items = buildConversationItems(
      [{ id: '1', fromMe: false, text: 'hi', createdAt: DAY2 }],
      zaps,
    );
    const zapItem = items.find((i) => i.kind === 'zap');
    expect(zapItem).toMatchObject({ kind: 'zap', amountSats: 500, comment: 'gm' });
  });
});

describe('buildZapItems', () => {
  it('includes only txs whose zap counterparty is this peer', () => {
    const wallets = [
      walletWithTx({ paymentHash: 'h1', settled_at: DAY2, zapCounterparty: cp(PEER) }),
      walletWithTx({ paymentHash: 'h2', settled_at: DAY2, zapCounterparty: cp(OTHER) }),
    ];
    const out = buildZapItems(wallets, PEER);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'zap', fromMe: false });
  });

  it('marks outgoing txs as fromMe and uses the absolute amount', () => {
    const out = buildZapItems(
      [
        walletWithTx({
          type: 'outgoing',
          amount: -250,
          settled_at: DAY2,
          paymentHash: 'h3',
          zapCounterparty: cp(PEER),
        }),
      ],
      PEER,
    );
    expect(out[0]).toMatchObject({ fromMe: true, amountSats: 250 });
  });

  it('skips txs with no settled_at or created_at timestamp', () => {
    const out = buildZapItems(
      [
        walletWithTx({
          created_at: undefined,
          settled_at: undefined,
          zapCounterparty: cp(PEER),
        }),
      ],
      PEER,
    );
    expect(out).toHaveLength(0);
  });
});

describe('buildConversationItems — unsupported message-kind fallback', () => {
  it('maps a message whose wireKind we do not render to an `unsupported` item', () => {
    const messages: ConversationMessageInput[] = [
      // kind 30023 (long-form article) is not a renderable DM kind.
      {
        id: '1',
        fromMe: false,
        text: 'whatever the raw body is',
        createdAt: DAY2,
        wireKind: 30023,
      },
    ];
    const items = buildConversationItems(messages, []).filter((i) => i.kind !== 'dayHeader');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'unsupported',
      id: 'dm-1',
      fromMe: false,
      rawKind: 30023,
      createdAt: DAY2,
    });
  });

  it('does NOT mark plain text (no wireKind) as unsupported', () => {
    const items = buildConversationItems(
      [{ id: '1', fromMe: false, text: 'hi', createdAt: DAY2 }],
      [],
    ).filter((i) => i.kind !== 'dayHeader');
    expect(items[0].kind).toBe('message');
  });

  it('does NOT mark renderable wire kinds (4/14/15) as unsupported', () => {
    for (const wireKind of [4, 14, 15]) {
      const items = buildConversationItems(
        [{ id: '1', fromMe: false, text: 'hi', createdAt: DAY2, wireKind }],
        [],
      ).filter((i) => i.kind !== 'dayHeader');
      expect(items[0].kind).toBe('message');
    }
  });

  it('renders a valid kind-16 order as an order card, not unsupported', () => {
    const orderJson = JSON.stringify({
      kind: 16,
      orderId: 'abc-123',
      type: 'order',
      items: [],
      message: '',
    });
    const items = buildConversationItems(
      [{ id: '1', fromMe: false, text: orderJson, createdAt: DAY2, wireKind: 16 }],
      [],
    ).filter((i) => i.kind !== 'dayHeader');
    expect(items[0].kind).toBe('order');
  });

  it('maps an unparseable kind-16/17 row to `unsupported`, never a raw JSON bubble', () => {
    // A non-order payload sharing the kind (e.g. a NIP-18 repost) or a corrupt row.
    const notAnOrder = JSON.stringify({ kind: 1, id: 'abc', content: 'gm' });
    const items = buildConversationItems(
      [{ id: '1', fromMe: false, text: notAnOrder, createdAt: DAY2, wireKind: 16 }],
      [],
    ).filter((i) => i.kind !== 'dayHeader');
    expect(items[0].kind).toBe('unsupported');
    expect(items[0].kind).not.toBe('message'); // never a raw text bubble
  });
});

describe('formatDayHeader', () => {
  // Build an epoch (seconds) at NOON on the calendar day `offsetDays` from
  // today. Calendar arithmetic via setDate + noon means a DST ±1h shift can't
  // push the timestamp across a day boundary (which `now - 24*3600` could).
  const noonEpochOffset = (offsetDays: number): number => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(12, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };

  it('labels today and yesterday relatively', () => {
    expect(formatDayHeader(noonEpochOffset(0))).toBe('Today');
    expect(formatDayHeader(noonEpochOffset(-1))).toBe('Yesterday');
  });

  it('falls back to a numeric date for older days', () => {
    const label = formatDayHeader(DAY1);
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label).toMatch(/\d/);
  });
});
