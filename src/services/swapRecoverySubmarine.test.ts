// Submarine (on-chain → LN) recovery: previously these records were persisted
// but never indexed OR read, so a crash mid-swap stranded the on-chain funds
// with no UI. These tests cover the new index + recovery branch.
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
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../utils/lockupTx', () => ({ extractLockupFromTxHex: jest.fn() }));

import {
  recoverPendingSwaps,
  registerPendingSubmarineSwap,
  setSubmarineRefundHandler,
  type PersistedSubmarineSwap,
} from './swapRecoveryService';

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
  // Empty the reverse index so runRecoveryPass reaches the submarine branch.
  mockStore.set('boltz_swap_index', JSON.stringify([]));
  seed();
  await registerPendingSubmarineSwap(SWAP_ID);
});

describe('submarine swap recovery', () => {
  it('registers submarine swaps in their own index', async () => {
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([SWAP_ID]);
  });

  it('invokes the refund handler on a terminal failure and keeps the record', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    setSubmarineRefundHandler(handler);
    mockFetchWithTimeout.mockImplementation(() => status('invoice.failedToPay'));

    await recoverPendingSwaps();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual(expect.objectContaining({ id: SWAP_ID }));
    // Record + index survive so a dismissed prompt re-surfaces next pass.
    expect(mockStore.has(KEY)).toBe(true);
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
});
