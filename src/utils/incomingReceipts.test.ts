import {
  pickNewReceipts,
  settledIncomingHashes,
  isValidPaymentHash,
  shouldSeedBaseline,
} from './incomingReceipts';
import type { WalletTransaction } from '../types/wallet';

// Valid payment hashes are 64 hex chars.
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

const tx = (p: Partial<WalletTransaction>): WalletTransaction => ({
  type: 'incoming',
  amount: 0,
  ...p,
});

describe('isValidPaymentHash', () => {
  it('accepts a 64-hex hash and rejects malformed values', () => {
    expect(isValidPaymentHash(H1)).toBe(true);
    expect(isValidPaymentHash('abc')).toBe(false); // too short
    expect(isValidPaymentHash('g'.repeat(64))).toBe(false); // non-hex
    expect(isValidPaymentHash(undefined)).toBe(false);
    expect(isValidPaymentHash(null)).toBe(false);
  });
});

describe('pickNewReceipts (#653 — dedup receives by payment_hash)', () => {
  it('returns a settled incoming tx with an unseen hash', () => {
    const txns = [tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: H1 })];
    expect(pickNewReceipts(txns, new Set())).toEqual([
      { paymentHash: H1, amountSats: 111, settledAt: 100 },
    ]);
  });

  it('does NOT re-announce an already-seen hash (the flapping-balance dupe fix)', () => {
    const txns = [tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: H1 })];
    expect(pickNewReceipts(txns, new Set([H1]))).toEqual([]);
  });

  it('skips a malformed payment_hash (would otherwise re-announce on a changing bad value)', () => {
    const txns = [
      tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: 'not-a-hash' }),
      tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: 'abc123' }),
    ];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('skips outgoing transactions', () => {
    const txns = [tx({ type: 'outgoing', amount: 50, settled_at: 100, paymentHash: H2 })];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('skips unsettled incoming (no settled_at yet — not a receipt)', () => {
    const txns = [
      tx({ type: 'incoming', amount: 111, settled_at: null, paymentHash: H1 }),
      tx({ type: 'incoming', amount: 111, paymentHash: H2 }), // settled_at undefined
    ];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('skips incoming without a payment_hash (no dedup key)', () => {
    const txns = [tx({ type: 'incoming', amount: 111, settled_at: 100 })];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('returns only the new hashes when some are already seen', () => {
    const txns = [
      tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: H1 }),
      tx({ type: 'incoming', amount: 222, settled_at: 200, paymentHash: H2 }),
    ];
    expect(pickNewReceipts(txns, new Set([H1]))).toEqual([
      { paymentHash: H2, amountSats: 222, settledAt: 200 },
    ]);
  });
});

describe('shouldSeedBaseline (#725 — own baselining, never off in-state txns)', () => {
  it('is true only when the wallet has never been baselined', () => {
    expect(shouldSeedBaseline(undefined)).toBe(true);
  });

  it('is false once a baseline exists (even an EMPTY one)', () => {
    // The empty-set case is the crux of #725 case (c): a wallet added with no
    // history seeds an empty baseline on first fetch, and that empty set must
    // still count as "baselined" so a later REAL receive is announced (not re-
    // baselined away) by the detector.
    expect(shouldSeedBaseline(new Set<string>())).toBe(false);
    expect(shouldSeedBaseline(new Set(['a'.repeat(64)]))).toBe(false);
  });
});

describe('settledIncomingHashes (silent baseline seed)', () => {
  it('collects only well-formed settled incoming hashes', () => {
    const txns = [
      tx({ type: 'incoming', amount: 1, settled_at: 100, paymentHash: H1 }),
      tx({ type: 'incoming', amount: 1, settled_at: null, paymentHash: H2 }), // pending
      tx({ type: 'outgoing', amount: 1, settled_at: 100, paymentHash: H2 }), // outgoing
      tx({ type: 'incoming', amount: 1, settled_at: 100, paymentHash: 'bad' }), // malformed
      tx({ type: 'incoming', amount: 1, settled_at: 100 }), // no hash
    ];
    expect(settledIncomingHashes(txns)).toEqual(new Set([H1]));
  });
});
