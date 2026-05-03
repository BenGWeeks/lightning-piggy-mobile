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
  // `kind` distinguishes a zap-shaped row (carries an amount) from a
  // DM-shaped row (always 0 sats — buildDmSummaries hard-codes 0).
  // Defaulting to the realistic shape per kind keeps the merge tests
  // honest: passing 21 to every DM row would mask amount-handling
  // regressions inside mergeSummaries.
  function summary(
    pubkey: string | null,
    ts: number,
    comment = '',
    kind: 'zap' | 'dm' = 'zap',
  ): ConversationSummary {
    return {
      id: pubkey ?? `anon:${ts}`,
      pubkey,
      name: pubkey ?? 'anon',
      picture: null,
      nip05: null,
      lightningAddress: null,
      lastActivityAt: ts,
      lastAmountSats: kind === 'dm' ? 0 : pubkey ? 21 : 9,
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
    const d = summary(PK_A, 1000 + 60, 'hi from DM', 'dm');
    const merged = mergeSummaries([z], [d]);
    expect(merged).toHaveLength(1);
    expect(merged[0].lastComment).toBe('hi from DM');
    expect(merged[0].lastAmountSats).toBe(0);
  });

  it('uses the newer raw row outside the preference window', () => {
    const z = summary(PK_A, 1000, '');
    const d = summary(PK_A, 1000 + 10 * 60, 'much later', 'dm');
    const merged = mergeSummaries([z], [d]);
    expect(merged).toHaveLength(1);
    expect(merged[0].lastComment).toBe('much later');
    // Outside the window → the DM is the newest, and DM rows from
    // buildDmSummaries always carry lastAmountSats = 0. Asserting 0
    // here keeps the test in step with what production really emits.
    expect(merged[0].lastAmountSats).toBe(0);
  });

  it('passes through a zap-only or DM-only partner unchanged', () => {
    const merged = mergeSummaries([summary(PK_A, 1000, '')], [summary(PK_B, 2000, 'hi', 'dm')]);
    // Sorted newest-first.
    expect(merged.map((m) => m.pubkey)).toEqual([PK_B, PK_A]);
  });
});

// ---------- formatConversationTimestamp ----------

describe('formatConversationTimestamp', () => {
  // Build NOW + every fixture in *local* time so the calendar-day
  // comparisons inside formatConversationTimestamp (which use
  // `getFullYear/getMonth/getDate`) stay stable across host TZs.
  // A pinned UTC string would shift to a different local day on
  // hosts like UTC-10 / UTC+14, breaking the same-day / Yesterday
  // assertions.
  const NOW = new Date();
  NOW.setFullYear(2026, 4 /* May */, 3);
  NOW.setHours(12, 0, 0, 0);
  const localSec = (
    year: number,
    month0: number,
    day: number,
    hour = 0,
    minute = 0,
    second = 0,
  ): number => {
    const d = new Date();
    d.setFullYear(year, month0, day);
    d.setHours(hour, minute, second, 0);
    return Math.floor(d.getTime() / 1000);
  };

  it('renders "now" inside the same minute', () => {
    expect(formatConversationTimestamp(localSec(2026, 4, 3, 11, 59, 30), NOW)).toBe('now');
  });

  it('renders minute granularity within the hour', () => {
    expect(formatConversationTimestamp(localSec(2026, 4, 3, 11, 30), NOW)).toBe('30m');
  });

  it('renders hour granularity within the same calendar day', () => {
    expect(formatConversationTimestamp(localSec(2026, 4, 3, 8, 0), NOW)).toBe('4h');
  });

  it('renders "Yesterday" for the previous calendar day', () => {
    expect(formatConversationTimestamp(localSec(2026, 4, 2, 20, 0), NOW)).toBe('Yesterday');
  });

  it('renders an explicit short date for older entries', () => {
    const ts = localSec(2026, 3 /* April */, 10, 12, 0);
    const out = formatConversationTimestamp(ts, NOW);
    // Compute the expected localised date substring at runtime so the
    // assertion is locale-agnostic — `Apr` only appears for English
    // locales; `de-DE` produces "10. Apr.", `ar-EG` Arabic digits, etc.
    const expectedDateStr = new Date(ts * 1000).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    expect(out).toBe(expectedDateStr);
  });

  it('includes the year for older years', () => {
    const out = formatConversationTimestamp(localSec(2024, 11 /* December */, 31, 12, 0), NOW);
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
    // conversationPreview uses `(12345).toLocaleString()` so the
    // grouping separator depends on the host locale (`12,345` /
    // `12.345` / `12 345` / Arabic digits, etc.). Compute the
    // expected number locally so the assertion stays valid in any
    // locale.
    const expectedAmount = (12345).toLocaleString();
    expect(out).toBe(`⚡ ${expectedAmount} sats`);
  });
});
