// Focused coverage for recoverPendingSwaps' 404 tolerance: a transient 404
// from the status endpoint must NOT destroy claim secrets — only
// SWAP_404_DELETE_THRESHOLD (3) consecutive misses may clean up, and a
// successful status read in between resets the streak.
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
// lockupTx pulls in bitcoinjs-lib, whose vendored uint8array-tools ships
// ESM-only under the react-native export condition — same transform issue
// documented in swapRecoveryService.test.ts. The 404 paths under test never
// reach the parser, so stub the module boundary.
jest.mock('../utils/lockupTx', () => ({ extractLockupFromTxHex: jest.fn() }));
jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

import { recoverPendingSwaps } from './swapRecoveryService';

const SWAP_ID = 'r-swap-1';
const RECORD_KEY = `boltz_swap_${SWAP_ID}`;

function seedSwap(): void {
  mockStore.set('boltz_swap_index', JSON.stringify([SWAP_ID]));
  mockStore.set(
    RECORD_KEY,
    JSON.stringify({
      id: SWAP_ID,
      preimage: 'ab'.repeat(32),
      claimPrivateKey: 'cd'.repeat(32),
      lockupAddress: 'bc1qexample',
      destinationAddress: 'bc1qdest',
    }),
  );
}

const notFound = () => Promise.resolve({ ok: false, status: 404 } as Response);
const pending = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ status: 'swap.created' }),
  } as unknown as Response);

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  seedSwap();
});

describe('recoverPendingSwaps 404 tolerance', () => {
  it('keeps the claim secrets through the first two consecutive 404s', async () => {
    mockFetchWithTimeout.mockImplementation(notFound);
    await recoverPendingSwaps();
    expect(mockStore.has(RECORD_KEY)).toBe(true);
    expect(JSON.parse(mockStore.get(RECORD_KEY)!).notFoundCount).toBe(1);

    await recoverPendingSwaps();
    expect(mockStore.has(RECORD_KEY)).toBe(true);
    expect(JSON.parse(mockStore.get(RECORD_KEY)!).notFoundCount).toBe(2);
  });

  it('cleans up only on the third consecutive 404', async () => {
    mockFetchWithTimeout.mockImplementation(notFound);
    await recoverPendingSwaps();
    await recoverPendingSwaps();
    await recoverPendingSwaps();
    expect(mockStore.has(RECORD_KEY)).toBe(false);
    expect(JSON.parse(mockStore.get('boltz_swap_index')!)).toEqual([]);
  });

  it('a successful status read resets the 404 streak', async () => {
    mockFetchWithTimeout.mockImplementation(notFound);
    await recoverPendingSwaps();
    await recoverPendingSwaps();
    mockFetchWithTimeout.mockImplementation(pending);
    await recoverPendingSwaps();
    expect(JSON.parse(mockStore.get(RECORD_KEY)!).notFoundCount).toBeUndefined();

    // Streak restarts from 1 — the record survives two more misses.
    mockFetchWithTimeout.mockImplementation(notFound);
    await recoverPendingSwaps();
    await recoverPendingSwaps();
    expect(mockStore.has(RECORD_KEY)).toBe(true);
  });
});
