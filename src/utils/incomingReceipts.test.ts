import { pickNewReceipts, settledIncomingHashes } from './incomingReceipts';
import type { WalletTransaction } from '../types/wallet';

const tx = (p: Partial<WalletTransaction>): WalletTransaction => ({
  type: 'incoming',
  amount: 0,
  ...p,
});

describe('pickNewReceipts (#653 — dedup receives by payment_hash)', () => {
  it('returns a settled incoming tx with an unseen hash', () => {
    const txns = [tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: 'h1' })];
    expect(pickNewReceipts(txns, new Set())).toEqual([{ paymentHash: 'h1', amountSats: 111 }]);
  });

  it('does NOT re-announce an already-seen hash (the flapping-balance dupe fix)', () => {
    const txns = [tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: 'h1' })];
    expect(pickNewReceipts(txns, new Set(['h1']))).toEqual([]);
  });

  it('skips outgoing transactions', () => {
    const txns = [tx({ type: 'outgoing', amount: 50, settled_at: 100, paymentHash: 'h2' })];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('skips unsettled incoming (no settled_at yet — not a receipt)', () => {
    const txns = [
      tx({ type: 'incoming', amount: 111, settled_at: null, paymentHash: 'h3' }),
      tx({ type: 'incoming', amount: 111, paymentHash: 'h4' }), // settled_at undefined
    ];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('skips incoming without a payment_hash (no dedup key)', () => {
    const txns = [tx({ type: 'incoming', amount: 111, settled_at: 100 })];
    expect(pickNewReceipts(txns, new Set())).toEqual([]);
  });

  it('returns only the new hashes when some are already seen', () => {
    const txns = [
      tx({ type: 'incoming', amount: 111, settled_at: 100, paymentHash: 'old' }),
      tx({ type: 'incoming', amount: 222, settled_at: 200, paymentHash: 'new' }),
    ];
    expect(pickNewReceipts(txns, new Set(['old']))).toEqual([
      { paymentHash: 'new', amountSats: 222 },
    ]);
  });
});

describe('settledIncomingHashes (silent baseline seed)', () => {
  it('collects only settled incoming hashes', () => {
    const txns = [
      tx({ type: 'incoming', amount: 1, settled_at: 100, paymentHash: 'in-settled' }),
      tx({ type: 'incoming', amount: 1, settled_at: null, paymentHash: 'in-pending' }),
      tx({ type: 'outgoing', amount: 1, settled_at: 100, paymentHash: 'out' }),
      tx({ type: 'incoming', amount: 1, settled_at: 100 }), // no hash
    ];
    expect(settledIncomingHashes(txns)).toEqual(new Set(['in-settled']));
  });
});
