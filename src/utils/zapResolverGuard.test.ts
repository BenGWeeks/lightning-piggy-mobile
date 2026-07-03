import {
  computePendingHash,
  shouldSkipResolve,
  type PendingTxLike,
  type ResolverFingerprint,
} from './zapResolverGuard';

const tx = (over: Partial<PendingTxLike['tx']>, idx: number): PendingTxLike => ({
  idx,
  tx: { paymentHash: null, bolt11: null, created_at: null, ...over },
});

describe('computePendingHash', () => {
  it('is deterministic for the same pending set', () => {
    const pending = [tx({ paymentHash: 'h1' }, 0), tx({ paymentHash: 'h2' }, 1)];
    expect(computePendingHash(pending)).toBe(computePendingHash(pending));
  });

  it('changes when a transaction is added', () => {
    const before = [tx({ paymentHash: 'h1' }, 0)];
    const after = [tx({ paymentHash: 'h1' }, 0), tx({ paymentHash: 'h2' }, 1)];
    expect(computePendingHash(before)).not.toBe(computePendingHash(after));
  });

  it('changes when a transaction is removed', () => {
    const before = [tx({ paymentHash: 'h1' }, 0), tx({ paymentHash: 'h2' }, 1)];
    const after = [tx({ paymentHash: 'h1' }, 0)];
    expect(computePendingHash(before)).not.toBe(computePendingHash(after));
  });

  it('changes when order changes (idx is part of the key)', () => {
    const a = [tx({ paymentHash: 'h1' }, 0), tx({ paymentHash: 'h2' }, 1)];
    const b = [tx({ paymentHash: 'h2' }, 0), tx({ paymentHash: 'h1' }, 1)];
    expect(computePendingHash(a)).not.toBe(computePendingHash(b));
  });

  it('falls back paymentHash → bolt11 → created_at for the id component', () => {
    expect(computePendingHash([tx({ bolt11: 'lnbc1' }, 0)])).toBe('0:lnbc1');
    expect(computePendingHash([tx({ created_at: 1700000000 }, 0)])).toBe('0:1700000000');
    // paymentHash wins when present
    expect(computePendingHash([tx({ paymentHash: 'h', bolt11: 'lnbc1' }, 0)])).toBe('0:h');
  });

  it('returns an empty string for an empty pending set', () => {
    expect(computePendingHash([])).toBe('');
  });
});

describe('shouldSkipResolve', () => {
  const fp = (pendingHash: string, storageVersion: number): ResolverFingerprint => ({
    pendingHash,
    storageVersion,
  });

  it('skips when the fingerprint matches exactly and not forced', () => {
    expect(
      shouldSkipResolve({
        current: fp('abc', 3),
        persisted: fp('abc', 3),
        force: false,
      }),
    ).toBe(true);
  });

  it('runs when the pending hash changed', () => {
    expect(
      shouldSkipResolve({
        current: fp('abc', 3),
        persisted: fp('xyz', 3),
        force: false,
      }),
    ).toBe(false);
  });

  it('runs when the storage version changed (a resolution landed)', () => {
    expect(
      shouldSkipResolve({
        current: fp('abc', 4),
        persisted: fp('abc', 3),
        force: false,
      }),
    ).toBe(false);
  });

  it('runs when there is no persisted fingerprint (first launch)', () => {
    expect(
      shouldSkipResolve({
        current: fp('abc', 3),
        persisted: null,
        force: false,
      }),
    ).toBe(false);
  });

  it('always runs when forced, even on an exact match (pull-to-refresh)', () => {
    expect(
      shouldSkipResolve({
        current: fp('abc', 3),
        persisted: fp('abc', 3),
        force: true,
      }),
    ).toBe(false);
  });
});
