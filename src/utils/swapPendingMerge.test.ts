import {
  buildSwapPlaceholders,
  markSwapPlaceholdersResolved,
  preserveOptimisticSwapRows,
} from './swapPendingMerge';
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

  it('keeps a new placeholder when only a HISTORICAL same-type swap is in the list', () => {
    // A swapId-tagged tx already present in `existing` (a prior swap) must NOT
    // supersede a brand-new placeholder whose own leg hasn't settled (#895 edge,
    // Copilot review).
    const historical: WalletTransaction = {
      type: 'incoming',
      amount: 99,
      swapId: 'old',
      settled_at: NOW - 9999,
    };
    const kept = preserveOptimisticSwapRows(
      [historical],
      [historical, opt({ type: 'incoming' })],
      NOW,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].swapId).toBeUndefined();
  });
});

describe('swapId-tagged placeholders (live emulator findings)', () => {
  // A 30,000-sat LN → on-chain move: Boltz locked 29,000 on-chain.
  const reverse = buildSwapPlaceholders({
    swapId: 'rev1',
    swapType: 'reverse',
    sentSats: 30000,
    receivedSats: 29000,
    nowSeconds: NOW - 30,
  });

  it('builds optimistic rows carrying the swap id and per-leg amounts', () => {
    expect(reverse.outgoing).toMatchObject({
      type: 'outgoing',
      amount: 30000,
      description: 'Boltz swap in progress',
      swapId: 'rev1',
      swapType: 'reverse',
      optimistic: true,
      settled_at: null,
      created_at: NOW - 30,
    });
    expect(reverse.incoming).toMatchObject({ type: 'incoming', amount: 29000, swapId: 'rev1' });
  });

  it('drops its own placeholder when its tagged leg settles, beside an untagged straggler', () => {
    // A legacy untagged placeholder of the same direction (e.g. left by a
    // failed earlier attempt) used to block the type-level fallback, leaving
    // BOTH rows next to the real "Sent" leg. The tagged row now matches exactly.
    const straggler = opt({ type: 'outgoing', created_at: NOW - 120 });
    const fresh: WalletTransaction[] = [
      {
        type: 'outgoing',
        amount: 30000,
        description: 'Boltz swap — sent via Lightning',
        paymentHash: 'ph',
        swapId: 'rev1',
        swapType: 'reverse',
        settled_at: NOW,
      },
    ];
    const kept = preserveOptimisticSwapRows(fresh, [reverse.outgoing, straggler], NOW);
    expect(kept).toEqual([straggler]);
  });

  it('drops a resolved swap placeholder even when its real leg is untagged or not yet synced', () => {
    const other = buildSwapPlaceholders({
      swapId: 'sub9',
      swapType: 'submarine',
      sentSats: 30500,
      receivedSats: 30000,
      nowSeconds: NOW - 10,
    });
    const legacy = opt({ type: 'outgoing' });
    const existing = [reverse.outgoing, other.outgoing, legacy];
    // Before resolution nothing identifies the untagged "Sent" row as rev1's.
    const untaggedSent: WalletTransaction[] = [
      { type: 'outgoing', amount: 30000, description: 'Sent', paymentHash: 'ph', settled_at: NOW },
    ];
    expect(preserveOptimisticSwapRows(untaggedSent, existing, NOW)).toHaveLength(3);

    markSwapPlaceholdersResolved('rev1');
    // Only rev1's rows go: the other in-flight swap and the untagged row stay.
    expect(preserveOptimisticSwapRows(untaggedSent, existing, NOW)).toEqual([
      other.outgoing,
      legacy,
    ]);
    expect(preserveOptimisticSwapRows([], [reverse.incoming, other.incoming], NOW)).toEqual([
      other.incoming,
    ]);
  });
});
