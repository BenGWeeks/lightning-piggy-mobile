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

  it('keeps concurrent same-direction placeholders when one real leg appears', () => {
    // Two same-direction swaps started before either settles; the first settled
    // leg must NOT drop BOTH placeholders — we can't tell which it belongs to,
    // so keep them and let the 1h age-out clear the straggler.
    const fresh: WalletTransaction[] = [
      { type: 'outgoing', amount: 30000, swapId: 'sw1', settled_at: NOW },
    ];
    const existing = [
      opt({ type: 'outgoing', created_at: NOW - 30 }),
      opt({ type: 'outgoing', created_at: NOW - 20 }),
    ];
    expect(preserveOptimisticSwapRows(fresh, existing, NOW)).toHaveLength(2);
  });

  it('supersedes exactly by swapId when placeholders carry one', () => {
    // swapId-tagged placeholders: only the matching one drops, even concurrently.
    const fresh: WalletTransaction[] = [
      { type: 'outgoing', amount: 30000, swapId: 'sw1', settled_at: NOW },
    ];
    const existing = [
      opt({ type: 'outgoing', swapId: 'sw1' }),
      opt({ type: 'outgoing', swapId: 'sw2' }),
    ];
    const kept = preserveOptimisticSwapRows(fresh, existing, NOW);
    expect(kept).toHaveLength(1);
    expect(kept[0].swapId).toBe('sw2');
  });
});
