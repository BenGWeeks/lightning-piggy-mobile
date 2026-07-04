// amountSatsFromBolt11 gates verifyReverseSwapInvoice, so its amount handling
// must fail CLOSED. The decoder is mocked — what's under test is our msats→sats
// conversion and the sub-sat rejection, not light-bolt11-decoder itself.
const mockDecode = jest.fn();
jest.mock('light-bolt11-decoder', () => ({ decode: (...a: unknown[]) => mockDecode(...a) }));

import { amountSatsFromBolt11 } from './bolt11';

function withAmountMsats(value: string | undefined) {
  mockDecode.mockReturnValue({
    sections: value === undefined ? [] : [{ name: 'amount', value }],
  });
}

beforeEach(() => jest.clearAllMocks());

describe('amountSatsFromBolt11', () => {
  it('converts a whole-sat (1000-multiple msats) amount', () => {
    withAmountMsats('82405000'); // 82,405 sats
    expect(amountSatsFromBolt11('lnbc...')).toBe(82_405);
  });

  it('fails closed on a sub-sat msats amount (not a 1000-multiple)', () => {
    withAmountMsats('82405999'); // 82,405 sats + 999 msats
    expect(amountSatsFromBolt11('lnbc...')).toBeNull();
  });

  it('returns null for an amountless invoice, negative, or non-numeric', () => {
    withAmountMsats(undefined);
    expect(amountSatsFromBolt11('lnbc...')).toBeNull();
    withAmountMsats('-1000');
    expect(amountSatsFromBolt11('lnbc...')).toBeNull();
    withAmountMsats('abc');
    expect(amountSatsFromBolt11('lnbc...')).toBeNull();
  });

  it('returns null when the decoder throws', () => {
    mockDecode.mockImplementation(() => {
      throw new Error('bad invoice');
    });
    expect(amountSatsFromBolt11('lnbc...')).toBeNull();
  });
});
