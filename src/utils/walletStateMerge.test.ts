import { applyResolverResults, mergeWalletUpdate } from './walletStateMerge';
import type { WalletState, WalletTransaction } from '../types/wallet';

const w = (over: Partial<WalletState> = {}): WalletState =>
  ({ id: 'a', balance: 100, ...over }) as WalletState;

describe('mergeWalletUpdate', () => {
  it('returns the SAME array identity when the update is a field-level no-op', () => {
    const prev = [w({ id: 'a', balance: 100 }), w({ id: 'b', balance: 5 })];
    const next = mergeWalletUpdate(prev, 'a', { balance: 100 });
    expect(next).toBe(prev); // referential equality → no re-render
  });

  it('returns a new array when a field actually changes', () => {
    const prev = [w({ id: 'a', balance: 100 })];
    const next = mergeWalletUpdate(prev, 'a', { balance: 250 });
    expect(next).not.toBe(prev);
    expect(next[0].balance).toBe(250);
  });

  it('only updates the targeted wallet', () => {
    const prev = [w({ id: 'a', balance: 100 }), w({ id: 'b', balance: 5 })];
    const next = mergeWalletUpdate(prev, 'b', { balance: 9 });
    expect(next[0]).toBe(prev[0]); // untouched wallet keeps identity
    expect(next[1].balance).toBe(9);
  });

  it('returns prev unchanged when the wallet id is not found', () => {
    const prev = [w({ id: 'a' })];
    expect(mergeWalletUpdate(prev, 'missing', { balance: 1 })).toBe(prev);
  });

  it('commits when one of several fields differs', () => {
    const prev = [w({ id: 'a', balance: 100, name: 'Old' } as Partial<WalletState>)];
    const next = mergeWalletUpdate(prev, 'a', {
      balance: 100,
      name: 'New',
    } as Partial<WalletState>);
    expect(next).not.toBe(prev);
  });
});

describe('applyResolverResults', () => {
  const tx = (over: Partial<WalletTransaction> = {}): WalletTransaction =>
    ({ type: 'incoming', amount: 1, ...over }) as WalletTransaction;
  const alice = { pubkey: 'alice', profile: null, comment: '', anonymous: false };

  it('attributes rows by index and leaves the rest untouched', () => {
    const prev = [tx({ paymentHash: 'a' }), tx({ paymentHash: 'b' })];
    const next = applyResolverResults(prev, new Map([[1, alice]]));
    expect(next?.[0]).toBe(prev[0]);
    expect(next?.[1]).toEqual({ ...prev[1], zapCounterparty: alice });
  });

  it('returns null when a forced pass only re-confirms missing attributions', () => {
    const prev = [tx(), tx({ zapCounterparty: null })];
    const results = new Map([
      [0, null],
      [1, null],
    ]);
    expect(applyResolverResults(prev, results)).toBeNull();
  });
});
