/**
 * Coverage for the conversation-list builders. The tests pin each
 * documented merge rule:
 *
 *  - one zap row per identified pubkey (newest wins),
 *  - anonymous zaps each get their own row,
 *  - DM rule 1 (NIP-17 beats NIP-04 inside the dual-publish window),
 *  - DM rule 2 (newer wins outside the window),
 *  - merge: DM preview text wins when zap + DM are within
 *    DM_PREVIEW_PREFERENCE_WINDOW_SEC, sort key is the newer of the
 *    two timestamps, anonymous zaps pass through.
 */

import {
  buildConversationSummaries,
  buildDmSummaries,
  conversationPreview,
  formatConversationTimestamp,
  mergeSummaries,
  type ConversationSummary,
  type DmInboxEntry,
} from './conversationSummaries';
import type { WalletState, WalletTransaction, ZapCounterpartyInfo } from '../types/wallet';
import type { NostrContact } from '../types/nostr';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

function makeWallet(transactions: WalletTransaction[]): WalletState {
  return {
    id: 'w1',
    alias: 'Test',
    theme: 'lightning-piggy',
    order: 0,
    walletType: 'nwc',
    lightningAddress: null,
    isConnected: true,
    balance: 0,
    walletAlias: null,
    transactions,
    // Cast to absorb fields not relevant to these tests.
  } as unknown as WalletState;
}

function zapTx(opts: {
  type: 'incoming' | 'outgoing';
  amount: number;
  ts: number;
  counterparty: ZapCounterpartyInfo | undefined;
  paymentHash?: string;
}): WalletTransaction {
  return {
    type: opts.type,
    amount: opts.amount,
    settled_at: opts.ts,
    paymentHash: opts.paymentHash,
    zapCounterparty: opts.counterparty,
  } as WalletTransaction;
}

function counterparty(
  pubkey: string | null,
  overrides: Partial<ZapCounterpartyInfo> = {},
): ZapCounterpartyInfo {
  return {
    pubkey,
    profile: null,
    comment: '',
    anonymous: pubkey === null,
    ...overrides,
  };
}

// ---------- buildConversationSummaries ----------

describe('buildConversationSummaries', () => {
  it('returns an empty list when no wallets / no zap-tagged txs are present', () => {
    expect(buildConversationSummaries([], [])).toEqual([]);
    expect(buildConversationSummaries([makeWallet([])], [])).toEqual([]);
  });

  it('skips transactions without a zapCounterparty info object', () => {
    const w = makeWallet([
      // type-cast: this tx has no counterparty info, must be ignored.
      { type: 'incoming', amount: 100, settled_at: 10 } as WalletTransaction,
    ]);
    expect(buildConversationSummaries([w], [])).toEqual([]);
  });

  it('merges multiple zaps for one pubkey into a single row, keeping the newest', () => {
    const w = makeWallet([
      zapTx({ type: 'incoming', amount: 21, ts: 1000, counterparty: counterparty(PK_A) }),
      zapTx({
        type: 'outgoing',
        amount: 100,
        ts: 2000,
        counterparty: counterparty(PK_A, { comment: 'thanks' }),
      }),
    ]);
    const out = buildConversationSummaries([w], []);
    expect(out).toHaveLength(1);
    expect(out[0].pubkey).toBe(PK_A);
    expect(out[0].lastActivityAt).toBe(2000);
    expect(out[0].lastDirection).toBe('outgoing');
    expect(out[0].lastComment).toBe('thanks');
    expect(out[0].lastAmountSats).toBe(100);
  });

  it('keeps anonymous zaps as their own rows, ordered newest-first', () => {
    const w = makeWallet([
      zapTx({
        type: 'incoming',
        amount: 50,
        ts: 1000,
        paymentHash: 'h1',
        counterparty: counterparty(null),
      }),
      zapTx({
        type: 'incoming',
        amount: 75,
        ts: 2000,
        paymentHash: 'h2',
        counterparty: counterparty(null),
      }),
    ]);
    const out = buildConversationSummaries([w], []);
    expect(out).toHaveLength(2);
    expect(out[0].lastActivityAt).toBe(2000);
    expect(out[0].id).toContain('anon:');
    expect(out[0].anonymous).toBe(true);
  });

  it("uses the contact's profile name when the counterparty profile is missing", () => {
    const contact: NostrContact = {
      pubkey: PK_A,
      relay: null,
      petname: undefined,
      profile: {
        pubkey: PK_A,
        npub: 'npub1ignored',
        name: null,
        displayName: 'Alice',
        picture: null,
        banner: null,
        about: null,
        lud16: null,
        nip05: null,
      },
    } as unknown as NostrContact;
    const w = makeWallet([
      zapTx({ type: 'incoming', amount: 21, ts: 100, counterparty: counterparty(PK_A) }),
    ]);
    const out = buildConversationSummaries([w], [contact]);
    expect(out[0].name).toBe('Alice');
  });
});

// ---------- buildDmSummaries ----------

describe('buildDmSummaries', () => {
  function dm(partner: string, createdAt: number, wireKind: number, text = 'hi'): DmInboxEntry {
    return {
      id: `${partner}-${createdAt}-${wireKind}`,
      partnerPubkey: partner,
      fromMe: false,
      createdAt,
      text,
      wireKind,
    };
  }

  it('keeps one summary per partner, newest-first', () => {
    const out = buildDmSummaries([dm(PK_A, 100, 4), dm(PK_B, 200, 4)], []);
    expect(out.map((s) => s.pubkey)).toEqual([PK_B, PK_A]);
  });

  it('respects an explicit follow filter', () => {
    const out = buildDmSummaries(
      [dm(PK_A, 100, 4), dm(PK_B, 200, 4)],
      [],
      new Set([PK_A.toLowerCase()]),
    );
    expect(out.map((s) => s.pubkey)).toEqual([PK_A]);
  });

  it('prefers a NIP-17 message over a NIP-04 twin within the dual-publish window', () => {
    // diff = 60 s — well inside the 5-min window. NIP-17 (kind-14) must
    // win even though it arrived first / is older.
    const out = buildDmSummaries([dm(PK_A, 1000, 14, 'wrap'), dm(PK_A, 1060, 4, 'legacy')], []);
    expect(out).toHaveLength(1);
    expect(out[0].lastComment).toBe('wrap');
  });

  it('prefers the newer message when both are the same wire kind', () => {
    const out = buildDmSummaries([dm(PK_A, 1000, 14, 'older'), dm(PK_A, 1100, 14, 'newer')], []);
    expect(out[0].lastComment).toBe('newer');
  });

  it('outside the dual-publish window: newer wins regardless of wire kind', () => {
    // diff = 6 minutes > 5-min window → rule 2 applies.
    const out = buildDmSummaries(
      [dm(PK_A, 1000, 14, 'old wrap'), dm(PK_A, 1000 + 6 * 60, 4, 'much newer kind4')],
      [],
    );
    expect(out[0].lastComment).toBe('much newer kind4');
  });

  it('marks fromMe outgoing direction', () => {
    const out = buildDmSummaries([{ ...dm(PK_A, 100, 14, 'sent'), fromMe: true }], []);
    expect(out[0].lastDirection).toBe('outgoing');
  });
});

// ---------- mergeSummaries ----------

describe('mergeSummaries', () => {
  function summary(pubkey: string | null, ts: number, comment = ''): ConversationSummary {
    return {
      id: pubkey ?? `anon:${ts}`,
      pubkey,
      name: pubkey ?? 'anon',
      picture: null,
      nip05: null,
      lightningAddress: null,
      lastActivityAt: ts,
      lastAmountSats: pubkey ? 21 : 9,
      lastDirection: 'incoming',
      lastComment: comment,
      anonymous: pubkey === null,
    };
  }

  it('passes anonymous zap rows through untouched', () => {
    const out = mergeSummaries([summary(null, 1000)], []);
    expect(out).toHaveLength(1);
    expect(out[0].anonymous).toBe(true);
  });

  it('uses the DM preview when zap + DM are within the preference window', () => {
    const z = summary(PK_A, 1000, '');
    const d = summary(PK_A, 1000 + 60, 'hi from DM');
    const merged = mergeSummaries([z], [d]);
    expect(merged).toHaveLength(1);
    expect(merged[0].lastComment).toBe('hi from DM');
    expect(merged[0].lastAmountSats).toBe(0);
  });

  it('uses the newer raw row outside the preference window', () => {
    const z = summary(PK_A, 1000, '');
    const d = summary(PK_A, 1000 + 10 * 60, 'much later');
    const merged = mergeSummaries([z], [d]);
    expect(merged).toHaveLength(1);
    expect(merged[0].lastComment).toBe('much later');
    // outside the window → the DM is the newest, but lastAmountSats
    // takes the newest's value (which the DM shape provides as 21).
    expect(merged[0].lastAmountSats).toBe(21);
  });

  it('passes through a zap-only or DM-only partner unchanged', () => {
    const merged = mergeSummaries([summary(PK_A, 1000, '')], [summary(PK_B, 2000, 'hi')]);
    // Sorted newest-first.
    expect(merged.map((m) => m.pubkey)).toEqual([PK_B, PK_A]);
  });
});

// ---------- formatConversationTimestamp ----------

describe('formatConversationTimestamp', () => {
  const NOW = new Date('2026-05-03T12:00:00.000Z');
  const sec = (d: string) => Math.floor(new Date(d).getTime() / 1000);

  it('renders "now" inside the same minute', () => {
    expect(formatConversationTimestamp(sec('2026-05-03T11:59:30.000Z'), NOW)).toBe('now');
  });

  it('renders minute granularity within the hour', () => {
    expect(formatConversationTimestamp(sec('2026-05-03T11:30:00.000Z'), NOW)).toBe('30m');
  });

  it('renders hour granularity within the same calendar day', () => {
    expect(formatConversationTimestamp(sec('2026-05-03T08:00:00.000Z'), NOW)).toBe('4h');
  });

  it('renders "Yesterday" for the previous calendar day', () => {
    expect(formatConversationTimestamp(sec('2026-05-02T20:00:00.000Z'), NOW)).toBe('Yesterday');
  });

  it('renders an explicit short date for older entries', () => {
    const out = formatConversationTimestamp(sec('2026-04-10T12:00:00.000Z'), NOW);
    expect(out).toMatch(/Apr/i);
    expect(out).not.toMatch(/Yesterday/);
  });

  it('includes the year for older years', () => {
    const out = formatConversationTimestamp(sec('2024-12-31T12:00:00.000Z'), NOW);
    expect(out).toContain('2024');
  });
});

// ---------- conversationPreview ----------

describe('conversationPreview', () => {
  const base = {
    id: PK_A,
    pubkey: PK_A,
    name: 'Alice',
    picture: null,
    nip05: null,
    lightningAddress: null,
    lastActivityAt: 0,
    anonymous: false,
  };

  it('uses the comment when one is present', () => {
    expect(
      conversationPreview({
        ...base,
        lastAmountSats: 100,
        lastDirection: 'incoming',
        lastComment: 'thanks!',
      }),
    ).toBe('thanks!');
  });

  it('prefixes outgoing with "You: "', () => {
    expect(
      conversationPreview({
        ...base,
        lastAmountSats: 21,
        lastDirection: 'outgoing',
        lastComment: 'hello',
      }),
    ).toBe('You: hello');
  });

  it('falls back to a sat amount when there is no comment', () => {
    const out = conversationPreview({
      ...base,
      lastAmountSats: 12345,
      lastDirection: 'incoming',
      lastComment: '',
    });
    expect(out).toBe('⚡ 12,345 sats');
  });
});
