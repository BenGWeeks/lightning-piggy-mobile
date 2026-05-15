// Unit tests for the pure helpers exported from swapRecoveryService.
// The recovery loop itself (recoverPendingSwaps) is heavy I/O — SecureStore +
// fetch + boltzService.claimSwap — and is intentionally not covered here.

import * as SecureStore from 'expo-secure-store';
import {
  isBoltzTransaction,
  hasClaimedPaymentHash,
  getClaimTxId,
  recordClaimedPaymentHash,
  subscribeClaimed,
} from './swapRecoveryService';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

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

describe('claimed-hash cache', () => {
  // The module loads its claimed-hash cache from SecureStore on import.
  // Tests share a single module instance, so we use uniquely-prefixed
  // hashes per test to avoid cross-test interference. The cache mutates
  // module-level state by design — that's the contract callers rely on.
  const HASH_A = '0000000000000000000000000000000000000000000000000000000000000aaa';
  const HASH_B = '0000000000000000000000000000000000000000000000000000000000000bbb';
  const HASH_C = '0000000000000000000000000000000000000000000000000000000000000ccc';
  const TXID_A = 'a'.repeat(64);
  const TXID_B = 'b'.repeat(64);

  beforeEach(() => {
    (SecureStore.setItemAsync as jest.Mock).mockClear();
  });

  it('hasClaimedPaymentHash + getClaimTxId reflect recorded entries', async () => {
    await recordClaimedPaymentHash(HASH_A, TXID_A);
    expect(hasClaimedPaymentHash(HASH_A)).toBe(true);
    expect(getClaimTxId(HASH_A)).toBe(TXID_A);
  });

  it('records null claim txid when only terminal-success is known', async () => {
    await recordClaimedPaymentHash(HASH_B, null);
    expect(hasClaimedPaymentHash(HASH_B)).toBe(true);
    // `null` is meaningfully different from `undefined`: it means we
    // know the claim succeeded but don't have the txid; consumers like
    // TransactionDetailSheet skip the Claim-tx row in this case.
    expect(getClaimTxId(HASH_B)).toBeNull();
  });

  it('returns undefined for never-recorded hashes', () => {
    expect(hasClaimedPaymentHash('deadbeef'.repeat(8))).toBe(false);
    expect(getClaimTxId('deadbeef'.repeat(8))).toBeUndefined();
  });

  it('persists each record fire-and-forget to SecureStore', async () => {
    await recordClaimedPaymentHash(HASH_C, TXID_B);
    // Allow the dangling .catch() chain a microtask to schedule the setItem call.
    await Promise.resolve();
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    const [key, value] = (SecureStore.setItemAsync as jest.Mock).mock.calls[
      (SecureStore.setItemAsync as jest.Mock).mock.calls.length - 1
    ];
    expect(key).toBe('boltz_claimed_hashes_v1');
    const arr = JSON.parse(value as string) as [string, string | null][];
    expect(arr).toContainEqual([HASH_C, TXID_B]);
  });

  it('subscribeClaimed fires on new inserts and returns an unsubscribe fn', async () => {
    const cb = jest.fn();
    const unsub = subscribeClaimed(cb);
    const UNIQUE = 'f'.repeat(64);
    await recordClaimedPaymentHash(UNIQUE, null);
    expect(cb).toHaveBeenCalled();
    cb.mockClear();
    unsub();
    await recordClaimedPaymentHash('e'.repeat(64), null);
    expect(cb).not.toHaveBeenCalled();
  });
});
