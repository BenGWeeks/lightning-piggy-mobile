import * as SecureStore from 'expo-secure-store';
import { createSubmarineSwapForward } from './boltzService';
import { registerPendingSubmarineSwap } from './swapRecoveryService';
import { createRecoverableSubmarineSwap } from './createRecoverableSubmarineSwap';

jest.mock('./boltzService', () => ({ createSubmarineSwapForward: jest.fn() }));
jest.mock('./swapRecoveryService', () => ({ registerPendingSubmarineSwap: jest.fn() }));
const swap = {
  id: 'fixture',
  address: 'address',
  expectedAmount: 101,
  timeoutBlockHeight: 900144,
  refundPrivateKey: 'key',
  claimPublicKey: 'pubkey',
  swapTree: {
    claimLeaf: { version: 192, output: 'claim' },
    refundLeaf: { version: 192, output: 'refund' },
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createSubmarineSwapForward).mockResolvedValue(swap);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  jest.mocked(registerPendingSubmarineSwap).mockResolvedValue();
});
it('binds the requested amount and saves full recovery material before resolving', async () => {
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source')).resolves.toBe(swap);
  expect(createSubmarineSwapForward).toHaveBeenCalledWith('invoice', 100);
  const [, raw, options] = jest.mocked(SecureStore.setItemAsync).mock.calls[0];
  expect(JSON.parse(raw)).toMatchObject({ ...swap, sourceWalletId: 'source' });
  expect(options).toEqual({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  expect(registerPendingSubmarineSwap).toHaveBeenCalledWith('fixture');
});
it('never persists or registers an unverified swap', async () => {
  jest.mocked(createSubmarineSwapForward).mockRejectedValueOnce(new Error('Invalid swap'));
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source')).rejects.toThrow(
    'Invalid swap',
  );
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(registerPendingSubmarineSwap).not.toHaveBeenCalled();
});
it('does not return funding instructions when persistence fails', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Disk full'));
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source')).rejects.toThrow(
    'Disk full',
  );
  expect(registerPendingSubmarineSwap).not.toHaveBeenCalled();
});
