import type { SwapFees } from '../services/boltzService';
import {
  claimBudgetFeeRate,
  quoteClaimFeeRate,
  DUST_SATS,
  planReverseClaim,
  quoteExactRecipient,
  reverseInvoiceForLockup,
  reverseRecipientRange,
} from './reverseSwapAmounts';

// Shaped like getReverseSwapFees: minerFee is OUR claim fee at the quoted rate
// (152 vB × 2 sat/vB).
const FEES: SwapFees = {
  percentage: 0.5,
  claimFeeRate: 2,
  minerFee: 304,
  lockupMinerFee: 1000,
  minAmount: 25_000,
  maxAmount: 25_000_000,
  pairHash: 'h',
};

describe('reverseInvoiceForLockup', () => {
  it("mirrors Boltz's onchainAmount maths: ceil((L + lockup fee) / (1 − pct))", () => {
    expect(reverseInvoiceForLockup(98_500, FEES)).toBe(100_000);
    expect(reverseInvoiceForLockup(98_501, FEES)).toBe(100_002);
  });

  it('is the smallest whole invoice that covers the lockup plus fees', () => {
    for (const fees of [FEES, { ...FEES, percentage: 0.1, lockupMinerFee: 462 }]) {
      for (let lockup = 10_000; lockup < 2_000_000; lockup += 7_919) {
        const invoice = reverseInvoiceForLockup(lockup, fees);
        const exact = (lockup + fees.lockupMinerFee!) / (1 - fees.percentage / 100);
        expect(invoice).toBeGreaterThanOrEqual(exact);
        expect(invoice - 1).toBeLessThan(exact);
      }
    }
  });
});

describe('quoteExactRecipient', () => {
  it('delivers exactly the requested amount and puts every fee on top (#1175)', () => {
    const quote = quoteExactRecipient(64_000, FEES);
    expect(quote.recipientSats).toBe(64_000);
    // Quoted 2 sat/vB → budgeted at 3 sat/vB × 152 vB.
    expect(quote.claimFeeSats).toBe(456);
    expect(quote.lockupSats).toBe(64_456);
    expect(quote.invoiceSats).toBe(Math.ceil(65_456 / 0.995));
    expect(quote.feeSats).toBe(quote.invoiceSats - 64_000);
  });

  it('falls back to the rate implied by minerFee when no claim rate is given', () => {
    const { claimFeeRate: _omit, ...noRate } = FEES;
    expect(quoteExactRecipient(64_000, noRate).claimFeeSats).toBe(456);
  });
});

describe('quote claim rate', () => {
  it('rounds the live estimate up to a whole rate, never below the relay floor', () => {
    expect(quoteClaimFeeRate(1.02)).toBe(2);
    expect(quoteClaimFeeRate(3)).toBe(3);
    expect(quoteClaimFeeRate(0.4)).toBe(1);
  });

  it('budgets an exact claim with at least 1 sat/vB, or 25%, of headroom', () => {
    expect(claimBudgetFeeRate(1)).toBe(2);
    expect(claimBudgetFeeRate(2)).toBe(3);
    expect(claimBudgetFeeRate(20)).toBe(25);
    expect(claimBudgetFeeRate(41)).toBe(52);
  });
});

describe('reverseRecipientRange', () => {
  const invoiceFor = (n: number, fees = FEES) => quoteExactRecipient(n, fees).invoiceSats;

  it("translates Boltz's invoice limits to the recipient side", () => {
    const range = reverseRecipientRange(FEES)!;
    expect(invoiceFor(range.minSats)).toBeGreaterThanOrEqual(FEES.minAmount);
    expect(invoiceFor(range.minSats - 1)).toBeLessThan(FEES.minAmount);
    expect(invoiceFor(range.maxSats)).toBeLessThanOrEqual(FEES.maxAmount);
    expect(invoiceFor(range.maxSats + 1)).toBeGreaterThan(FEES.maxAmount);
    // Recipient bounds sit below the invoice bounds by the fees.
    expect(range.minSats).toBeLessThan(FEES.minAmount);
    expect(range.maxSats).toBeLessThan(FEES.maxAmount);
  });

  it('caps the maximum so recipient + fees fit the balance ("send max")', () => {
    const range = reverseRecipientRange(FEES, 73_294)!;
    expect(invoiceFor(range.maxSats)).toBeLessThanOrEqual(73_294);
    expect(invoiceFor(range.maxSats + 1)).toBeGreaterThan(73_294);
  });

  it('returns null when even the minimum swap does not fit the balance', () => {
    expect(reverseRecipientRange(FEES, 20_000)).toBeNull();
    expect(reverseRecipientRange(FEES, 0)).toBeNull();
  });

  it('never offers a dust recipient output', () => {
    const range = reverseRecipientRange({ ...FEES, minAmount: 1 })!;
    expect(range.minSats).toBe(DUST_SATS + 1);
  });
});

describe('planReverseClaim', () => {
  it('pays an exact-recipient swap precisely, spending the whole budget as fee', () => {
    expect(
      planReverseClaim({ lockupSats: 64_456, requiredFeeSats: 140, recipientSats: 64_000 }),
    ).toEqual({ outputSats: 64_000, feeSats: 456, exact: true });
    // Right at the budget is still exact.
    expect(
      planReverseClaim({ lockupSats: 64_456, requiredFeeSats: 456, recipientSats: 64_000 }).exact,
    ).toBe(true);
  });

  it('pays the required fee once the budget no longer covers it', () => {
    expect(
      planReverseClaim({ lockupSats: 64_456, requiredFeeSats: 457, recipientSats: 64_000 }),
    ).toEqual({ outputSats: 64_456 - 457, feeSats: 457, exact: false });
  });

  it('keeps legacy invoice-amount swaps paying the required fee out of the lockup', () => {
    expect(planReverseClaim({ lockupSats: 98_500, requiredFeeSats: 420 })).toEqual({
      outputSats: 98_080,
      feeSats: 420,
      exact: false,
    });
  });

  it('ignores a corrupt recipient amount rather than over-paying', () => {
    for (const recipientSats of [98_500, 98_501, 100, Number.NaN]) {
      expect(
        planReverseClaim({ lockupSats: 98_500, requiredFeeSats: 140, recipientSats }).exact,
      ).toBe(false);
    }
  });
});
