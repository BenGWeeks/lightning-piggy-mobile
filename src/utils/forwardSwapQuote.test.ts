import type { SwapFees } from '../services/boltzService';
import { formatForwardSwapFee, forwardSwapLockup, quoteForwardSwap } from './forwardSwapQuote';

// Submarine quote: Boltz's percentage + its own claim miner fee.
const FEES: SwapFees = {
  percentage: 0.1,
  minerFee: 573,
  minAmount: 25_000,
  maxAmount: 25_000_000,
  pairHash: 'h',
};

describe('forward (on-chain → Lightning) Move quote', () => {
  it("folds Boltz's fee into the lockup our wallet must send", () => {
    expect(forwardSwapLockup(60_000, FEES)).toEqual({ boltzFeeSats: 633, lockupSats: 60_633 });
  });

  it("adds the wallet's on-chain sending fee so the quote is the true total (#1175)", () => {
    const quote = quoteForwardSwap(60_000, FEES, 714);
    expect(quote).toEqual({
      invoiceSats: 60_000,
      boltzFeeSats: 633,
      lockupSats: 60_633,
      networkFeeSats: 714,
      totalFeeSats: 1_347,
    });
    expect(formatForwardSwapFee(quote)).toBe(
      `~${(1347).toLocaleString()} sats (Boltz ~633 + network ~714) · ~10-60 min`,
    );
  });
});

describe('forward Move quote without a priced network fee', () => {
  it("names the network fee instead of guessing it when the wallet can't price the send", () => {
    const quote = quoteForwardSwap(60_000, FEES, null);
    expect(quote.totalFeeSats).toBe(633);
    expect(formatForwardSwapFee(quote)).toBe('~633 sats Boltz + network fee · ~10-60 min');
  });
});
