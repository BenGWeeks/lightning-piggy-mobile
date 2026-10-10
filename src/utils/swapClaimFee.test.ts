import {
  FALLBACK_CLAIM_FEE_RATE,
  claimFeeBudget,
  claimFeeSats,
  selectClaimFeeRate,
} from './swapClaimFee';
import { REVERSE_CLAIM_VBYTES } from './reverseSwapVerify';

// Real claim d5c32785… (swap tTK3RrBZcrSR, #1174): weight 557 → 140 vB.
const REAL_CLAIM_VSIZE = 140;

describe('selectClaimFeeRate (sat/vB)', () => {
  it('uses the live estimate unrounded (not ceil-ed to a whole sat/vB)', () => {
    expect(selectClaimFeeRate(1.194, 3)).toBe(1.194);
  });

  it('prefers a lower live estimate over the quoted rate', () => {
    // The old code took max(quoted, live), so a quiet network at claim time
    // could never lower the fee.
    expect(selectClaimFeeRate(1.11, 3)).toBe(1.11);
  });

  it('floors at the 1 sat/vB relay minimum (not the old floor of 2)', () => {
    expect(selectClaimFeeRate(0.233, 3)).toBe(1);
  });

  it.each([null, undefined, NaN, 0, -1, Infinity, 5001])(
    'falls back to the quoted rate when the live estimate is %p',
    (estimate) => {
      expect(selectClaimFeeRate(estimate as number | null | undefined, 2.5)).toBe(2.5);
    },
  );

  it('falls back to the legacy default when there is no estimate and no quote', () => {
    expect(selectClaimFeeRate(null, undefined)).toBe(FALLBACK_CLAIM_FEE_RATE);
  });
});

describe('claimFeeBudget', () => {
  it('is the quoted size budget times the quoted rate, in sats', () => {
    expect(claimFeeBudget(3)).toBe(REVERSE_CLAIM_VBYTES * 3);
    expect(claimFeeBudget(2.229)).toBe(Math.ceil(REVERSE_CLAIM_VBYTES * 2.229));
  });

  it('is undefined for a legacy record without a quoted rate', () => {
    expect(claimFeeBudget(undefined)).toBeUndefined();
    expect(claimFeeBudget(NaN)).toBeUndefined();
  });
});

describe('claimFeeSats', () => {
  it('reproduces and fixes the #1174 overpayment', () => {
    // Old: ceil(180 vB × max(2, ceil(2.229))) = 540 sats on a 140 vB claim.
    const oldFee = Math.ceil(REVERSE_CLAIM_VBYTES * Math.max(2, Math.ceil(2.229)));
    expect(oldFee).toBe(540);
    // New: measured vsize × the ~3-block estimate (1.194 sat/vB at the time).
    const fee = claimFeeSats(REAL_CLAIM_VSIZE, selectClaimFeeRate(1.194, 3), claimFeeBudget(3));
    expect(fee).toBe(168);
  });

  it('charges the measured vsize, rounding the total up to whole sats', () => {
    expect(claimFeeSats(140, 1.5)).toBe(210);
    expect(claimFeeSats(141, 1.11)).toBe(157);
  });

  it('caps a mis-scaled estimate (sat/kvB read as sat/vB) at the quoted budget', () => {
    // 2229 sat/kvB = 2.229 sat/vB; a units slip would ask for ~312k sats.
    expect(claimFeeSats(REAL_CLAIM_VSIZE, 2229, claimFeeBudget(3))).toBe(540);
  });

  it('never drops below the relay floor, even if the budget is smaller', () => {
    expect(claimFeeSats(140, 0.5)).toBe(140);
    expect(claimFeeSats(140, 5, 100)).toBe(140);
  });

  it('rejects a non-integer vsize or a non-finite rate', () => {
    expect(() => claimFeeSats(139.25, 1)).toThrow(/vsize/);
    expect(() => claimFeeSats(0, 1)).toThrow(/vsize/);
    expect(() => claimFeeSats(140, NaN)).toThrow(/rate/);
  });
});
