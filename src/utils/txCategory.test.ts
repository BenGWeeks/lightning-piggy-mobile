/**
 * Coverage for the transaction-category classifier. The rules below
 * mirror the precedence comments in `getTxCategory`: Boltz beats
 * on-chain (a swap claim tx has a txid but should still render under
 * the Boltz icon), and on-chain beats lightning when blockHeight or
 * txid are present.
 */

import { getTxCategory } from './txCategory';

describe('getTxCategory', () => {
  it('classifies entries with a swapId as boltz', () => {
    expect(
      getTxCategory({
        swapId: 'B0Lt2',
        // even with an on-chain-looking txid present, swap wins
        txid: 'deadbeef',
        blockHeight: 800000,
      }),
    ).toBe('boltz');
  });

  it('matches "Boltz swap" in the description (case-insensitive)', () => {
    expect(getTxCategory({ description: 'Boltz Swap claim' })).toBe('boltz');
    expect(getTxCategory({ description: 'boltz swap' })).toBe('boltz');
  });

  it('matches "Send to BTC / Bitcoin" descriptions as boltz', () => {
    expect(getTxCategory({ description: 'send to BTC' })).toBe('boltz');
    expect(getTxCategory({ description: 'Send to bitcoin address' })).toBe('boltz');
  });

  it('matches "Receive from BTC / Bitcoin" descriptions as boltz', () => {
    expect(getTxCategory({ description: 'receive from BTC' })).toBe('boltz');
    expect(getTxCategory({ description: 'Receive from Bitcoin' })).toBe('boltz');
  });

  it('classifies as onchain when blockHeight is present', () => {
    expect(getTxCategory({ blockHeight: 825000 })).toBe('onchain');
  });

  it('classifies as onchain when only a txid is present', () => {
    expect(getTxCategory({ txid: 'abc123' })).toBe('onchain');
  });

  it('falls back to lightning for everything else', () => {
    expect(getTxCategory({})).toBe('lightning');
    expect(getTxCategory({ description: 'Pay invoice' })).toBe('lightning');
    expect(getTxCategory({ description: null, blockHeight: null })).toBe('lightning');
  });
});
