import {
  followUpSwapSettlement,
  isSwapLegDone,
  SWAP_SETTLE_REFRESH_DELAYS_MS,
} from './swapSettleFollowUp';
import type { WalletTransaction } from '../types/wallet';

const HASH = 'ab'.repeat(32);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Run the next scheduled tick, including its awaited refresh. */
const tick = async (ms: number) => {
  await jest.advanceTimersByTimeAsync(ms);
};

describe('followUpSwapSettlement (#1179)', () => {
  it('keeps refreshing until the leg settles, then stops', async () => {
    let settled = false;
    const refresh = jest.fn(async () => undefined);
    followUpSwapSettlement({ key: 'a', refresh, isDone: () => settled });

    await tick(SWAP_SETTLE_REFRESH_DELAYS_MS[0]);
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(SWAP_SETTLE_REFRESH_DELAYS_MS[1]);
    expect(refresh).toHaveBeenCalledTimes(2);

    // LNbits releases the reserve: the next tick sees it and stops.
    settled = true;
    await tick(SWAP_SETTLE_REFRESH_DELAYS_MS[2]);
    expect(refresh).toHaveBeenCalledTimes(3);
    await tick(60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('is bounded: never more refreshes than the schedule, even if the leg never settles', async () => {
    const refresh = jest.fn(async () => undefined);
    followUpSwapSettlement({ key: 'b', refresh, isDone: () => false });
    await tick(24 * 60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(SWAP_SETTLE_REFRESH_DELAYS_MS.length);
  });

  it('the schedule spans the ~8 min reserve hold seen on LNbits, and then some', () => {
    const total = SWAP_SETTLE_REFRESH_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(15 * 60_000);
    expect(total).toBeLessThanOrEqual(30 * 60_000);
  });

  it('a failing refresh does not end the follow-up', async () => {
    const refresh = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('relay timeout'))
      .mockResolvedValue(undefined);
    followUpSwapSettlement({ key: 'c', refresh, isDone: () => false });
    await tick(SWAP_SETTLE_REFRESH_DELAYS_MS[0]);
    await tick(SWAP_SETTLE_REFRESH_DELAYS_MS[1]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a repeat for the same key replaces the earlier follow-up instead of stacking', async () => {
    const first = jest.fn(async () => undefined);
    const second = jest.fn(async () => undefined);
    followUpSwapSettlement({ key: 'd', refresh: first, isDone: () => false });
    followUpSwapSettlement({ key: 'd', refresh: second, isDone: () => false });
    await tick(SWAP_SETTLE_REFRESH_DELAYS_MS[0]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel stops it', async () => {
    const refresh = jest.fn(async () => undefined);
    const cancel = followUpSwapSettlement({ key: 'e', refresh, isDone: () => false });
    cancel();
    await tick(60 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('isSwapLegDone', () => {
  const leg = (over: Partial<WalletTransaction>): WalletTransaction => ({
    type: 'outgoing',
    amount: 64_000,
    paymentHash: HASH,
    ...over,
  });

  it('waits while the wallet reports the leg pending, or has not listed it yet', () => {
    expect(isSwapLegDone([{ id: 'w', transactions: [leg({ settled: false })] }], 'w', HASH)).toBe(
      false,
    );
    expect(isSwapLegDone([{ id: 'w', transactions: [] }], 'w', HASH)).toBe(false);
  });

  it('done once the wallet reports it settled', () => {
    expect(isSwapLegDone([{ id: 'w', transactions: [leg({ settled: true })] }], 'w', HASH)).toBe(
      true,
    );
  });

  it("a local payment proof isn't enough while the wallet still reports it pending", () => {
    // mapNwcTransactions: settled (proof-backed) + walletPending (provider state).
    expect(
      isSwapLegDone(
        [{ id: 'w', transactions: [leg({ settled: true, walletPending: true })] }],
        'w',
        HASH,
      ),
    ).toBe(false);
  });

  it('an optimistic row is not the wallet speaking', () => {
    expect(
      isSwapLegDone(
        [{ id: 'w', transactions: [leg({ settled_at: 1, optimistic: true })] }],
        'w',
        HASH,
      ),
    ).toBe(false);
  });

  it('done when the wallet is gone (removed / profile switched)', () => {
    expect(isSwapLegDone([], 'w', HASH)).toBe(true);
  });
});
