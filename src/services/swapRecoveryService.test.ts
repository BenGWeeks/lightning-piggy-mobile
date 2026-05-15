// Unit tests for the pure helpers exported from swapRecoveryService.
// The recovery loop itself (recoverPendingSwaps) is heavy I/O — SecureStore +
// fetch + boltzService.claimSwap — and is intentionally not covered here.

import { isBoltzTransaction } from './swapRecoveryService';

describe('isBoltzTransaction', () => {
  it('returns false for null/undefined', () => {
    expect(isBoltzTransaction(null)).toBe(false);
    expect(isBoltzTransaction(undefined)).toBe(false);
  });

  it('returns true when swapId is set', () => {
    expect(isBoltzTransaction({ swapId: 'abc123' })).toBe(true);
  });

  it('returns true for Boltz-minted memos even without swapId', () => {
    // Settled swaps drop swapId in some wallet backends; the row falls back
    // to description-matching so green-tick still applies after settlement.
    expect(isBoltzTransaction({ description: 'Send to BTC address' })).toBe(true);
    expect(isBoltzTransaction({ description: 'Receive from BTC address' })).toBe(true);
    expect(isBoltzTransaction({ description: 'Send to bitcoin' })).toBe(true);
    expect(isBoltzTransaction({ description: 'Boltz swap claim' })).toBe(true);
  });

  it('is case-insensitive on memo matching', () => {
    expect(isBoltzTransaction({ description: 'send to btc address' })).toBe(true);
    expect(isBoltzTransaction({ description: 'BOLTZ SWAP' })).toBe(true);
  });

  it('returns false for unrelated memos', () => {
    expect(isBoltzTransaction({ description: 'Zap from alice@primal.net' })).toBe(false);
    expect(isBoltzTransaction({ description: 'Coffee tip' })).toBe(false);
    expect(isBoltzTransaction({ description: undefined })).toBe(false);
    expect(isBoltzTransaction({})).toBe(false);
  });
});
