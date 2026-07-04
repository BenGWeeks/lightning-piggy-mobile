// Submarine (on-chain → LN) recovery: previously these records were persisted
// but never indexed OR read, so a crash mid-swap stranded the on-chain funds
// with no UI. These tests cover the index + recovery branch, and the funding
// gate that stops the "needs attention / contact Boltz" alert from nagging for
// swaps that were created but never funded (nothing to recover).
const mockStore = new Map<string, string>();
const mockFetchWithTimeout = jest.fn();
const mockGetSubmarineSwapLockup = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
}));
jest.mock('./boltzService', () => ({
  claimSwap: jest.fn(),
  fetchWithTimeout: (...a: unknown[]) => mockFetchWithTimeout(...a),
  getSubmarineSwapLockup: (...a: unknown[]) => mockGetSubmarineSwapLockup(...a),
}));
jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));
jest.mock('../utils/lockupTx', () => ({ extractLockupFromTxHex: jest.fn() }));

import Toast from '../components/BrandedToast';
import {
  recoverPendingSwaps,
  registerPendingSubmarineSwap,
  setSubmarineRefundHandler,
  type PersistedSubmarineSwap,
} from './swapRecoveryService';

const mockToastShow = Toast.show as jest.Mock;

const SWAP_ID = 's-swap-1';
const KEY = `submarine_swap_${SWAP_ID}`;

// A lockup the funding gate treats as "funds locked on-chain".
const FUNDED_LOCKUP = { txId: 'aa'.repeat(32), vout: 0, amount: 50_000 };

function seed(over: Partial<PersistedSubmarineSwap> = {}): void {
  mockStore.set(
    KEY,
    JSON.stringify({
      id: SWAP_ID,
      address: 'bc1qlockup',
      expectedAmount: 50_000,
      refundPrivateKey: 'aa'.repeat(32),
      claimPublicKey: 'bb'.repeat(33),
      timeoutBlockHeight: 800_000,
      swapTree: { claimLeaf: {}, refundLeaf: {} },
      sourceWalletId: 'wallet-1',
      ...over,
    }),
  );
}

const status = (s: string) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ status: s }),
  } as unknown as Response);

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  setSubmarineRefundHandler(null);
  // Default: funds ARE locked on-chain, so the funding gate lets the fail
  // branch proceed. Tests exercising the unfunded path override this to null.
  mockGetSubmarineSwapLockup.mockResolvedValue(FUNDED_LOCKUP);
  // Empty the reverse index so runRecoveryPass reaches the submarine branch.
  mockStore.set('boltz_swap_index', JSON.stringify([]));
  seed();
  await registerPendingSubmarineSwap(SWAP_ID);
});

describe('submarine swap recovery', () => {
  it('registers submarine swaps in their own index', async () => {
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([SWAP_ID]);
  });

  it('invokes the refund handler on a funded terminal failure and keeps the record', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    setSubmarineRefundHandler(handler);
    mockFetchWithTimeout.mockImplementation(() => status('invoice.failedToPay'));

    await recoverPendingSwaps();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual(expect.objectContaining({ id: SWAP_ID }));
    // Record + index survive so a dismissed prompt re-surfaces next pass.
    expect(mockStore.has(KEY)).toBe(true);
  });

  it('re-surfaces the interactive refund prompt on every pass (not once-only)', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    setSubmarineRefundHandler(handler);
    mockFetchWithTimeout.mockImplementation(() => status('invoice.failedToPay'));

    await recoverPendingSwaps();
    await recoverPendingSwaps();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('cleans up on a terminal success', async () => {
    mockFetchWithTimeout.mockImplementation(() => status('invoice.settled'));
    await recoverPendingSwaps();
    expect(mockStore.has(KEY)).toBe(false);
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
  });

  it('leaves a still-pending swap untouched', async () => {
    const handler = jest.fn();
    setSubmarineRefundHandler(handler);
    mockFetchWithTimeout.mockImplementation(() => status('transaction.mempool'));
    await recoverPendingSwaps();
    expect(handler).not.toHaveBeenCalled();
    expect(mockStore.has(KEY)).toBe(true);
  });

  describe('funding gate', () => {
    it('retires an unfunded expired swap silently — no handler, no toast, record removed', async () => {
      const handler = jest.fn();
      setSubmarineRefundHandler(handler);
      // No on-chain lockup was ever made — nothing to recover.
      mockGetSubmarineSwapLockup.mockResolvedValue(null);
      mockFetchWithTimeout.mockImplementation(() => status('swap.expired'));

      await recoverPendingSwaps();

      expect(handler).not.toHaveBeenCalled();
      expect(mockToastShow).not.toHaveBeenCalled();
      expect(mockStore.has(KEY)).toBe(false);
      expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
    });

    it('retires an unfunded swap silently even when the lockup lookup throws', async () => {
      mockGetSubmarineSwapLockup.mockRejectedValue(new Error('network'));
      mockFetchWithTimeout.mockImplementation(() => status('swap.expired'));

      await recoverPendingSwaps();

      expect(mockToastShow).not.toHaveBeenCalled();
      expect(mockStore.has(KEY)).toBe(false);
    });

    it('retires a refunded swap silently (already resolved on-chain)', async () => {
      mockFetchWithTimeout.mockImplementation(() => status('transaction.refunded'));
      // transaction.refunded is short-circuited before the lockup lookup.
      await recoverPendingSwaps();
      expect(mockGetSubmarineSwapLockup).not.toHaveBeenCalled();
      expect(mockStore.has(KEY)).toBe(false);
      expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
    });
  });

  describe('funded-but-unrecoverable notify-once', () => {
    beforeEach(() => {
      // Funded (lockup present) but the record lacks the refund material, so
      // it can't be auto-refunded — the genuine "contact Boltz" case.
      seed({ swapTree: undefined, sourceWalletId: undefined });
    });

    it('alerts exactly once and keeps the record', async () => {
      mockFetchWithTimeout.mockImplementation(() => status('invoice.failedToPay'));

      await recoverPendingSwaps();

      const attentionCalls = mockToastShow.mock.calls.filter(
        (c) => c[0]?.text1 === 'Swap needs attention',
      );
      expect(attentionCalls).toHaveLength(1);
      expect(mockStore.has(KEY)).toBe(true);
      const persisted = JSON.parse(mockStore.get(KEY)!) as PersistedSubmarineSwap;
      expect(persisted.notifiedUnrecoverable).toBe(true);
    });

    it('does not re-alert on a second recovery pass', async () => {
      mockFetchWithTimeout.mockImplementation(() => status('invoice.failedToPay'));

      await recoverPendingSwaps();
      await recoverPendingSwaps();

      const attentionCalls = mockToastShow.mock.calls.filter(
        (c) => c[0]?.text1 === 'Swap needs attention',
      );
      expect(attentionCalls).toHaveLength(1);
      expect(mockStore.has(KEY)).toBe(true);
    });
  });
});
