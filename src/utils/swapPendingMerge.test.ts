import { preserveOptimisticSwapRows } from './swapPendingMerge';
import type { WalletTransaction } from '../types/wallet';

const NOW = 1_000_000;

const opt = (over: Partial<WalletTransaction> = {}): WalletTransaction => ({
  type: 'incoming',
  amount: 30000,
  description: 'Boltz swap in progress',
  optimistic: true,
  settled_at: null,
  created_at: NOW - 60,
  ...over,
});

describe('preserveOptimisticSwapRows (#896)', () => {
  it('keeps an optimistic Boltz row while no real swap leg has appeared', () => {
    expect(preserveOptimisticSwapRows([], [opt()], NOW)).toHaveLength(1);
  });

  it('drops it once a real swap leg of the same direction appears (swapId-tagged)', () => {
    const fresh: WalletTransaction[] = [
      { type: 'incoming', amount: 30000, swapId: 'sw', settled_at: NOW },
    ];
    expect(preserveOptimisticSwapRows(fresh, [opt({ type: 'incoming' })], NOW)).toHaveLength(0);
  });

  it('keeps it when the settled swap leg is the OTHER direction', () => {
    const fresh: WalletTransaction[] = [{ type: 'outgoing', amount: 30000, swapId: 'sw' }];
    expect(preserveOptimisticSwapRows(fresh, [opt({ type: 'incoming' })], NOW)).toHaveLength(1);
  });

  it('ages out a stale optimistic row past the 1h cap', () => {
    expect(preserveOptimisticSwapRows([], [opt({ created_at: NOW - 7200 })], NOW)).toHaveLength(0);
  });

  it('ignores non-optimistic, settled, and non-swap rows', () => {
    expect(preserveOptimisticSwapRows([], [opt({ optimistic: false })], NOW)).toHaveLength(0);
    expect(preserveOptimisticSwapRows([], [opt({ settled_at: NOW })], NOW)).toHaveLength(0);
    expect(
      preserveOptimisticSwapRows([], [opt({ description: 'Sent', swapType: undefined })], NOW),
    ).toHaveLength(0);
  });

  it('recognises a swap row by swapType even without a Boltz description', () => {
    expect(
      preserveOptimisticSwapRows([], [opt({ description: 'Pending', swapType: 'submarine' })], NOW),
    ).toHaveLength(1);
  });
});
