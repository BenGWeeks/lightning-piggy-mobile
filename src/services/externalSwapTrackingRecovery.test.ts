import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { trackExternalSwap, subscribeExternalSwap } from './externalSwapTracking';
import { watchSubmarineSwapStatus, fetchSwapStatus } from './boltzSwapStatus';
import { saveExternalSwap, loadExternalSwaps, type ExternalSwapState } from './externalSwapState';
import { recoverPendingSwaps, registerPendingSubmarineSwap } from './swapRecoveryService';
import Toast from '../components/BrandedToast';
import { fireNotification } from './notificationService';

const mockStore = new Map<string, string>();
const mockFetchWithTimeout = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));
jest.mock('./boltzService', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));
jest.mock('./boltzSwapStatus', () => ({
  ...jest.requireActual('./boltzSwapStatus'),
  watchSubmarineSwapStatus: jest.fn(),
  fetchSwapStatus: jest.fn(),
}));
jest.mock('./walletStorageService', () => ({ getActivePubkey: () => 'alice' }));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('./notificationService', () => ({ fireNotification: jest.fn() }));

const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

test('offline startup then reopening initializes durable tracking through payment and settlement', async () => {
  await AsyncStorage.clear();
  const swap: ExternalSwapState = {
    id: 'offline-startup',
    address: 'bc1qlockup',
    expectedAmount: 50000,
    timeoutBlockHeight: 800000,
    sourceWalletId: 'watch',
    destinationWalletId: 'lightning',
    ownerPubkey: 'alice',
    invoiceSats: 49000,
    invoice: 'invoice',
    createdAt: 123,
    status: 'swap.created',
  };
  const key = `submarine_swap_${swap.id}`;
  await SecureStore.setItemAsync(
    key,
    JSON.stringify({ ...swap, externalFunding: true, refundPrivateKey: 'PRIVATE' }),
  );
  await registerPendingSubmarineSwap(swap.id);
  await saveExternalSwap(swap);
  mockFetchWithTimeout.mockRejectedValueOnce(new Error('Offline'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await recoverPendingSwaps();
    expect(warn).toHaveBeenCalledWith(
      `[SwapRecovery] Failed to check submarine swap ${swap.id}:`,
      expect.any(Error),
    );
    expect(watchSubmarineSwapStatus).not.toHaveBeenCalled();
    expect(mockStore.has(key)).toBe(true);
  } finally {
    warn.mockRestore();
  }

  let update!: Parameters<typeof watchSubmarineSwapStatus>[1];
  let finish!: (value: Awaited<ReturnType<typeof watchSubmarineSwapStatus>>) => void;
  jest.mocked(fetchSwapStatus).mockResolvedValue('swap.created');
  jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(async (_id, onPhase) => {
    update = onPhase;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const saved = (await loadExternalSwaps('watch', 'lightning'))[0];
  const listener = jest.fn();
  const close = subscribeExternalSwap(saved.id, listener);
  const sibling = jest.fn();
  const closeSibling = subscribeExternalSwap(saved.id, sibling);
  try {
    await flush();
    expect(watchSubmarineSwapStatus).toHaveBeenCalledTimes(1);
    expect(fetchSwapStatus).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      id: swap.id,
      status: 'swap.created',
      trackingFailed: false,
    });
    const payment = { transaction: { id: 'funding-tx' } };
    update('detected', 'transaction.mempool', payment);
    await flush();
    expect(listener).toHaveBeenLastCalledWith({
      id: swap.id,
      status: 'transaction.mempool',
      raw: payment,
      trackingFailed: false,
    });
    expect(sibling).toHaveBeenLastCalledWith(listener.mock.calls.at(-1)?.[0]);
    expect((await loadExternalSwaps('watch', 'lightning'))[0].status).toBe('transaction.mempool');
    close();
    closeSibling();

    mockFetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'transaction.claimed' }),
    });
    update('complete', 'transaction.claimed', {});
    finish({ phase: 'complete', rawStatus: 'transaction.claimed', raw: {} });
    await flush();
    expect((await loadExternalSwaps('watch', 'lightning'))[0].status).toBe('transaction.claimed');
    expect(Toast.show).toHaveBeenCalledTimes(1);
    expect(fireNotification).toHaveBeenCalledTimes(1);
    expect(mockStore.has(key)).toBe(false);
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
  } finally {
    close();
    closeSibling();
  }
});

test.each([
  ['offline startup', 'transaction.claimed'],
  ['offline startup', 'swap.expired'],
  ['watcher failure', 'transaction.claimed'],
  ['watcher failure', 'swap.expired'],
])('reopening after %s persists terminal %s and runs recovery', async (startup, status) => {
  jest.clearAllMocks();
  mockStore.clear();
  await AsyncStorage.clear();
  const swap: ExternalSwapState = {
    id: `${startup.replace(/ /g, '-')}-${status.replace(/\./g, '-')}`,
    address: 'bc1qlockup',
    expectedAmount: 50000,
    timeoutBlockHeight: 800000,
    sourceWalletId: 'watch',
    destinationWalletId: 'lightning',
    ownerPubkey: 'alice',
    invoiceSats: 49000,
    invoice: 'invoice',
    createdAt: 123,
    status: 'swap.created',
  };
  const key = `submarine_swap_${swap.id}`;
  await SecureStore.setItemAsync(
    key,
    JSON.stringify({ ...swap, externalFunding: true, refundPrivateKey: 'PRIVATE' }),
  );
  await registerPendingSubmarineSwap(swap.id);
  await saveExternalSwap(swap);
  if (startup === 'offline startup') {
    mockFetchWithTimeout.mockRejectedValueOnce(new Error('Offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await recoverPendingSwaps();
    } finally {
      warn.mockRestore();
    }
  } else {
    jest.mocked(watchSubmarineSwapStatus).mockRejectedValueOnce(new Error('Offline'));
    trackExternalSwap(swap, recoverPendingSwaps);
    await flush();
  }
  const priorWatchers = jest.mocked(watchSubmarineSwapStatus).mock.calls.length;
  jest.mocked(fetchSwapStatus).mockResolvedValueOnce(status);
  mockFetchWithTimeout.mockImplementation(async (url: string) =>
    url.endsWith('/transaction')
      ? { ok: false, status: 404 }
      : { ok: true, json: async () => ({ status }) },
  );
  const listener = jest.fn();
  const close = subscribeExternalSwap(swap.id, listener);
  try {
    await flush();
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: swap.id, status, trackingFailed: false }),
    );
    expect(watchSubmarineSwapStatus).toHaveBeenCalledTimes(priorWatchers);
    expect((await loadExternalSwaps('watch', 'lightning'))[0].status).toBe(status);
    expect(Toast.show).toHaveBeenCalledTimes(status === 'transaction.claimed' ? 1 : 0);
    expect(fireNotification).toHaveBeenCalledTimes(status === 'transaction.claimed' ? 1 : 0);
    expect(mockStore.has(key)).toBe(false);
    expect(JSON.parse(mockStore.get('boltz_submarine_index')!)).toEqual([]);
    // Reopening a persisted terminal request must not notify twice.
    close();
    jest.mocked(fetchSwapStatus).mockResolvedValueOnce(status);
    const closeAgain = subscribeExternalSwap(swap.id, jest.fn());
    await flush();
    closeAgain();
    expect(fireNotification).toHaveBeenCalledTimes(status === 'transaction.claimed' ? 1 : 0);
  } finally {
    close();
  }
});
