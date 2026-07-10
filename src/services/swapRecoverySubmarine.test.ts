// Submarine (on-chain → LN) recovery: previously these records were persisted
// but never indexed OR read, so a crash mid-swap stranded the on-chain funds
// with no UI. These tests cover the index + recovery branch, and the funding
// gate that stops the "needs attention / contact Boltz" alert from nagging for
// swaps that were created but never funded (nothing to recover) — while never
// retiring a genuinely funded swap on a transient Boltz/network failure.
const mockStore = new Map<string, string>();
const mockFetchWithTimeout = jest.fn();

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
}));
jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));
jest.mock('../utils/lockupTx', () => ({ extractLockupFromTxHex: jest.fn() }));

import Toast from '../components/BrandedToast';
import { extractLockupFromTxHex } from '../utils/lockupTx';
import {
  recoverPendingSwaps,
  registerPendingSubmarineSwap,
  setSubmarineRefundHandler,
  type PersistedSubmarineSwap,
} from './swapRecoveryService';

const mockToastShow = Toast.show as jest.Mock;
const mockExtractLockup = extractLockupFromTxHex as jest.Mock;

const SWAP_ID = 's-swap-1';
const KEY = `submarine_swap_${SWAP_ID}`;

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

// The recovery pass hits two endpoints per submarine swap: the main status
// (`/swap/{id}`) and — on a failure — the lockup-transaction probe
// (`/swap/submarine/{id}/transaction`). Route by URL so each test can set the
// status and the funding outcome independently.
const mainStatus = (s: string) =>
  ({ ok: true, status: 200, json: () => Promise.resolve({ status: s }) }) as unknown as Response;
const lockupFound = () =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'lock-tx', hex: 'deadbeef' }),
  }) as unknown as Response;
const httpErr = (code: number) =>
  ({ ok: false, status: code, json: () => Promise.resolve({}) }) as unknown as Response;

/** Wire fetch: main endpoint → `status`; the lockup probe → `probe`. */
function route(status: string, probe: () => Response = lockupFound): void {
  mockFetchWithTimeout.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/transaction') ? probe() : mainStatus(status)),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  setSubmarineRefundHandler(null);
  // Default: a lockup output is parseable ⇒ the probe reads "funded". Tests
  // exercising the unfunded/indeterminate paths override the probe response.
  mockExtractLockup.mockReturnValue({ vout: 0, amount: 50_000 });
  // Empty the reverse index so runRecoveryPass reaches the submarine branch.
  mockStore.set('boltz_swap_index', JSON.stringify([]));
  seed();
  await registerPendingSubmarineSwap(SWAP_ID);
});

const attentionToasts = () =>
  mockToastShow.mock.calls.filter((c) => c[0]?.text1 === 'Swap needs attention');

describe('submarine swap recovery', () => {
  it('registers submarine swaps in their own index', async () => {
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([SWAP_ID]);
  });

  it('invokes the refund handler on a funded terminal failure and keeps the record', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    setSubmarineRefundHandler(handler);
    route('invoice.failedToPay');

    await recoverPendingSwaps();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual(expect.objectContaining({ id: SWAP_ID }));
    // Record + index survive so a dismissed prompt re-surfaces next pass.
    expect(mockStore.has(KEY)).toBe(true);
  });

  it('re-surfaces the interactive refund prompt on every pass (not once-only)', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    setSubmarineRefundHandler(handler);
    route('invoice.failedToPay');

    await recoverPendingSwaps();
    await recoverPendingSwaps();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('cleans up on a terminal success', async () => {
    route('invoice.settled');
    await recoverPendingSwaps();
    expect(mockStore.has(KEY)).toBe(false);
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
  });

  it('leaves a still-pending swap untouched', async () => {
    const handler = jest.fn();
    setSubmarineRefundHandler(handler);
    route('transaction.mempool');
    await recoverPendingSwaps();
    expect(handler).not.toHaveBeenCalled();
    expect(mockStore.has(KEY)).toBe(true);
  });

  describe('funding gate', () => {
    it('retires an unfunded expired swap silently — no handler, no toast, record removed', async () => {
      const handler = jest.fn();
      setSubmarineRefundHandler(handler);
      // The lockup probe 404s ⇒ Boltz has no lockup tx ⇒ never funded.
      route('swap.expired', () => httpErr(404));

      await recoverPendingSwaps();

      expect(handler).not.toHaveBeenCalled();
      expect(mockToastShow).not.toHaveBeenCalled();
      expect(mockStore.has(KEY)).toBe(false);
      expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
    });

    it('DEFERS (keeps the record, no toast) when the probe fails transiently — 5xx', async () => {
      const handler = jest.fn();
      setSubmarineRefundHandler(handler);
      // A 500 must NOT be read as unfunded — that would delete refund material.
      route('swap.expired', () => httpErr(500));

      await recoverPendingSwaps();

      expect(handler).not.toHaveBeenCalled();
      expect(mockToastShow).not.toHaveBeenCalled();
      expect(mockStore.has(KEY)).toBe(true);
      expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([SWAP_ID]);
    });

    it('DEFERS when the probe throws (network error) — record survives', async () => {
      mockFetchWithTimeout.mockImplementation((url: string) =>
        url.includes('/transaction')
          ? Promise.reject(new Error('network'))
          : Promise.resolve(mainStatus('swap.expired')),
      );

      await recoverPendingSwaps();

      expect(mockToastShow).not.toHaveBeenCalled();
      expect(mockStore.has(KEY)).toBe(true);
    });

    it('retires a refunded swap silently (already resolved on-chain), without probing', async () => {
      route('transaction.refunded');
      await recoverPendingSwaps();
      // transaction.refunded is short-circuited before the lockup probe.
      const probed = mockFetchWithTimeout.mock.calls.some((c) =>
        String(c[0]).includes('/transaction'),
      );
      expect(probed).toBe(false);
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
      route('invoice.failedToPay');

      await recoverPendingSwaps();

      expect(attentionToasts()).toHaveLength(1);
      expect(mockStore.has(KEY)).toBe(true);
      const persisted = JSON.parse(mockStore.get(KEY)!) as PersistedSubmarineSwap;
      expect(persisted.notifiedUnrecoverable).toBe(true);
    });

    it('does not re-alert on a second recovery pass', async () => {
      route('invoice.failedToPay');

      await recoverPendingSwaps();
      await recoverPendingSwaps();

      expect(attentionToasts()).toHaveLength(1);
      expect(mockStore.has(KEY)).toBe(true);
    });
  });
});
