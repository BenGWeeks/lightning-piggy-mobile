// The reverse-swap trust-boundary gate: pay Boltz's invoice ONLY when it
// binds to our preimage hash and our amount. The bolt11 helpers are mocked —
// they're thin wrappers over light-bolt11-decoder; what needs proving here is
// that every mismatch fails CLOSED before any payment.
const mockPaymentHash = jest.fn();
const mockAmountSats = jest.fn();

jest.mock('./bolt11', () => ({
  paymentHashFromBolt11: (...a: unknown[]) => mockPaymentHash(...a),
  amountSatsFromBolt11: (...a: unknown[]) => mockAmountSats(...a),
}));

import { verifyReverseSwapInvoice } from './boltzVerify';

const HASH = 'ab'.repeat(32);

beforeEach(() => {
  jest.clearAllMocks();
  mockPaymentHash.mockReturnValue(HASH);
  mockAmountSats.mockReturnValue(82_405);
});

describe('verifyReverseSwapInvoice', () => {
  const good = { invoice: 'lnbc1...', expectedPaymentHash: HASH, expectedAmountSats: 82_405 };

  it('passes when the payment hash and amount both match', () => {
    expect(() => verifyReverseSwapInvoice(good)).not.toThrow();
  });

  it('is case-insensitive on the payment hash', () => {
    mockPaymentHash.mockReturnValue(HASH.toUpperCase());
    expect(() => verifyReverseSwapInvoice(good)).not.toThrow();
  });

  it('throws when the invoice payment hash is not OUR preimage hash', () => {
    mockPaymentHash.mockReturnValue('cd'.repeat(32));
    expect(() => verifyReverseSwapInvoice(good)).toThrow(/payment hash does not match/);
  });

  it('throws when the invoice charges a different amount', () => {
    mockAmountSats.mockReturnValue(82_406);
    expect(() => verifyReverseSwapInvoice(good)).toThrow(/does not match the requested swap/);
  });

  it('fails closed on a missing invoice, undecodable hash, or amountless invoice', () => {
    expect(() => verifyReverseSwapInvoice({ ...good, invoice: '' })).toThrow(/no invoice/);
    mockPaymentHash.mockReturnValue(null);
    expect(() => verifyReverseSwapInvoice(good)).toThrow(/could not be decoded/);
    mockPaymentHash.mockReturnValue(HASH);
    mockAmountSats.mockReturnValue(null);
    expect(() => verifyReverseSwapInvoice(good)).toThrow(/no amount/);
  });
});
