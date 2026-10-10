import type { SwapFees } from '../services/boltzService';
import {
  reverseSwapAmountBounds,
  routingFeeReserve,
  reverseSwapSendBlocker,
  shortOnchainAddress,
} from './onchainSwapSend';
import { quoteExactRecipient, reverseRecipientRange } from './reverseSwapAmounts';

const FEES: SwapFees = {
  percentage: 0.5,
  claimFeeRate: 2,
  minerFee: 304,
  lockupMinerFee: 1000,
  minAmount: 25_000,
  maxAmount: 1_500_000,
  pairHash: 'h',
};

describe('reverseSwapSendBlocker', () => {
  const range = reverseRecipientRange(FEES)!;

  it('lets a send through when the TOTAL fits the balance', () => {
    const total = quoteExactRecipient(64_000, FEES).invoiceSats;
    expect(reverseSwapSendBlocker(64_000, FEES, total)).toBeNull();
    expect(reverseSwapSendBlocker(64_000, FEES, null)).toBeNull();
  });

  it('blocks when the balance covers the recipient amount but not the fees on top', () => {
    const quote = quoteExactRecipient(64_000, FEES);
    expect(reverseSwapSendBlocker(64_000, FEES, quote.invoiceSats - 1)).toEqual({
      key: 'sendSheet.swapInsufficientBalance',
      params: {
        total: quote.invoiceSats.toLocaleString(),
        amount: (64_000).toLocaleString(),
        fee: quote.feeSats.toLocaleString(),
        balance: (quote.invoiceSats - 1).toLocaleString(),
      },
    });
  });

  it("states Boltz's limits on the recipient side", () => {
    expect(reverseSwapSendBlocker(range.minSats - 1, FEES, null)).toEqual({
      key: 'sendSheet.minAmount',
      params: { min: range.minSats.toLocaleString() },
    });
    expect(reverseSwapSendBlocker(range.minSats, FEES, null)).toBeNull();
    expect(reverseSwapSendBlocker(range.maxSats + 1, FEES, null)).toEqual({
      key: 'sendSheet.maxAmount',
      params: { max: range.maxSats.toLocaleString() },
    });
  });

  it('asks for an amount when none was entered', () => {
    expect(reverseSwapSendBlocker(0, FEES, 1_000_000)).toEqual({ key: 'sendSheet.enterAmount' });
  });
});

describe('reverseSwapAmountBounds', () => {
  it('caps the amount step at the largest send the balance can pay for, keeping a routing reserve', () => {
    const budget = 73_294 - routingFeeReserve(73_294);
    expect(budget).toBe(72_561);
    const bounds = reverseSwapAmountBounds(FEES, 73_294)!;
    expect(quoteExactRecipient(bounds.maxSats, FEES).invoiceSats).toBeLessThanOrEqual(budget);
    expect(quoteExactRecipient(bounds.maxSats + 1, FEES).invoiceSats).toBeGreaterThan(budget);
  });

  it('reserves at least 10 sats for routing on small balances', () => {
    expect(routingFeeReserve(500)).toBe(10);
  });

  it("falls back to the server's range when the balance can't fund any swap", () => {
    expect(reverseSwapAmountBounds(FEES, 1_000)).toEqual(reverseRecipientRange(FEES));
  });
});

describe('shortOnchainAddress', () => {
  it('keeps the recognisable ends of an address for confirmation copy', () => {
    expect(shortOnchainAddress('bc1qsczwhrj6h7lunt02r66p4za8qdnapq6l0cc7dm')).toBe('bc1qsc…0cc7dm');
    expect(shortOnchainAddress('bc1qshort')).toBe('bc1qshort');
  });
});
