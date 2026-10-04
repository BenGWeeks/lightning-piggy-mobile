import { act, renderHook } from '@testing-library/react-native';
import * as nwcService from '../services/nwcService';
import * as walletStorage from '../services/walletStorageService';
import type { WalletState } from '../types/wallet';
import { useNwcConnectionWatchdog } from './useNwcConnectionWatchdog';

jest.mock('../services/nwcService', () => ({
  connect: jest.fn(async () => ({ success: true })),
  isWalletConnected: jest.fn(() => false),
  isSocketConnected: jest.fn(() => false),
  isRelayInCooldown: jest.fn(() => false),
  isConnectionInProgress: jest.fn(() => false),
  getWalletHealth: jest.fn(() => 'disconnected'),
}));

const wallets = [
  { id: 'busy', walletType: 'nwc' },
  { id: 'idle', walletType: 'nwc' },
] as WalletState[];

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(walletStorage, 'getNwcUrl').mockResolvedValue('nostr+walletconnect://fixture');
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('does not supersede a handshake that is already in flight', async () => {
  jest.mocked(nwcService.isConnectionInProgress).mockImplementation((id) => id === 'busy');
  const { unmount } = renderHook(() =>
    useNwcConnectionWatchdog({ current: wallets }, jest.fn(), () => () => true),
  );
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(nwcService.connect).toHaveBeenCalledTimes(1);
  expect(nwcService.connect).toHaveBeenCalledWith(
    'idle',
    'nostr+walletconnect://fixture',
    undefined,
    expect.any(Function),
  );
  unmount();
});
