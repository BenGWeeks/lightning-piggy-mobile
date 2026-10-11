import { renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nwcService from '../services/nwcService';
import { useWalletTransactionsFetch } from './useWalletTransactionsFetch';
import type { WalletState } from '../types/wallet';

jest.mock('../services/nwcService', () => ({
  listTransactions: jest.fn(),
  isValidPaymentHash: (h: unknown) => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h),
}));
jest.mock('../services/onchainService', () => ({ syncAndRefresh: jest.fn() }));
jest.mock('../services/swapRecoveryService', () => ({
  ensureSwapMetaLoaded: jest.fn().mockResolvedValue(undefined),
  getSwapMeta: jest.fn(() => undefined),
}));

const wallet = { id: 'w1', walletType: 'nwc', transactions: [] } as unknown as WalletState;

function setup(identityCurrent = true) {
  const deps = {
    walletsRef: { current: [wallet] },
    lastTxsJsonRef: { current: new Map<string, string>() },
    seenReceiptsRef: { current: new Map<string, Set<string>>() },
    resolveZapSendersRef: { current: jest.fn().mockResolvedValue(undefined) },
    updateWalletInState: jest.fn(),
    seedSeenReceipts: jest.fn(),
    captureWalletIdentity: () => () => identityCurrent,
  };
  const { result } = renderHook(() => useWalletTransactionsFetch(deps));
  return { fetch: result.current, deps };
}

describe('useWalletTransactionsFetch', () => {
  beforeEach(() => {
    jest.mocked(nwcService.listTransactions).mockReset();
  });

  it('resolves true and commits + persists the list on success', async () => {
    jest.mocked(nwcService.listTransactions).mockResolvedValue([]);
    const { fetch, deps } = setup();
    deps.lastTxsJsonRef.current.set('w1', 'stale');
    await expect(fetch('w1')).resolves.toBe(true);
    expect(deps.updateWalletInState).toHaveBeenCalledWith('w1', { transactions: [] });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('txs_w1', '[]');
    expect(deps.lastTxsJsonRef.current.get('w1')).toBe('[]');
  });

  it('resolves false (never rejects) when the fetch fails, so callers can retry', async () => {
    jest.mocked(nwcService.listTransactions).mockRejectedValue(new Error('reply timeout'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch, deps } = setup();
    await expect(fetch('w1')).resolves.toBe(false);
    expect(deps.updateWalletInState).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('resolves false for a wallet that is no longer in state', async () => {
    const { fetch } = setup();
    await expect(fetch('gone')).resolves.toBe(false);
    expect(nwcService.listTransactions).not.toHaveBeenCalled();
  });

  it('resolves false when the identity switched mid-fetch', async () => {
    jest.mocked(nwcService.listTransactions).mockResolvedValue([]);
    const { fetch, deps } = setup(false);
    await expect(fetch('w1')).resolves.toBe(false);
    expect(deps.updateWalletInState).not.toHaveBeenCalled();
  });
});
