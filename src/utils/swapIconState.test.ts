import { swapIconState } from './swapIconState';
import type { WalletTransaction } from '../types/wallet';

const tx = (over: Partial<WalletTransaction> = {}): WalletTransaction =>
  ({ type: 'outgoing', amount: 1000, paymentHash: 'ph', ...over }) as WalletTransaction;

const F = { isBoltz: true, inAttention: false, claimed: false };

describe('swapIconState', () => {
  it('returns undefined for non-Boltz rows', () => {
    expect(swapIconState(tx(), { ...F, isBoltz: false })).toBeUndefined();
  });

  it("returns 'attention' when flagged, regardless of settled/claimed", () => {
    expect(swapIconState(tx({ settled_at: 123 }), { ...F, inAttention: true })).toBe('attention');
  });

  it("returns 'pending' (clock) for an unsettled, unclaimed outgoing swap", () => {
    expect(swapIconState(tx({ settled_at: null }), F)).toBe('pending');
  });

  it("returns 'done' for an outgoing swap with a recorded claim even when settled_at is unset (#891 ambiguous-pay)", () => {
    // The core fix: pay_invoice was UNKNOWN so the LN leg never settled
    // locally, but the swap completed and the claim was recorded.
    expect(swapIconState(tx({ settled_at: null }), { ...F, claimed: true })).toBe('done');
  });

  it("returns 'done' for a settled incoming swap", () => {
    expect(swapIconState(tx({ type: 'incoming', settled_at: 123 }), F)).toBe('done');
  });

  it('leaves a settled outgoing swap without a recorded claim unbadged', () => {
    // LN leg can settle before the on-chain claim broadcasts — don't tick early.
    expect(swapIconState(tx({ settled_at: 123 }), F)).toBeUndefined();
  });

  it('treats a blockHeight-confirmed row as settled', () => {
    expect(swapIconState(tx({ type: 'incoming', settled_at: null, blockHeight: 800000 }), F)).toBe(
      'done',
    );
  });
});
